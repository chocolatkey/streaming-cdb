export function cdbHash(key) {
    let hash = 5381,
        length = key.length;

    for (let i = 0; i < length; i++) {
        hash = ((((hash << 5) >>> 0) + hash) ^ key.charCodeAt(i)) >>> 0;
    }

    return hash;
}

export default class StreamingCDB {
    /**
     * Stream a CDB file over HTTP using fetch
     * @param {string} file URL of the CDB file to stream
     * @param {Function} hash Optional custom hash function to use
     */
    constructor(file, hash=cdbHash) {
        this.hash = hash;
        this.file = file;
        this.header = new Array(TABLE_SIZE);
        this.cachedSlots = null;
    }

    /**
     * Open the CDB file for reading. This causes the CDB file's header and
     * trailing hash table to be read with two sequential fetch requests.
     */
    async open() {
        let r = await fetch(this.file, {
            headers: {
                range: `bytes=0-${HEADER_SIZE - 1}`
            }
        });
        const rawHeaderUints = new Uint32Array(await r.arrayBuffer());

        // Fill table
        let bufferPosition = 0;
        for (let i = 0; i < TABLE_SIZE; i++) {
            const position = rawHeaderUints[bufferPosition];
            const slotCount = rawHeaderUints[bufferPosition + 1];

            this.header[i] = {
                position: position,
                slotCount: slotCount
            };

            bufferPosition += 2;
        }

        r = await fetch(this.file, {
            headers: {
                range: `bytes=${this.header[0].position}-`
            }
        });
        this.cachedSlots = new Uint32Array(await r.arrayBuffer());
    }

    /**
     * Retrieve a stored value by key. Typically, this requires two sequential fetch requests, one to
     * find the record entry (key/data length), the other to read the stored data. In the rare even
     * of a hash collision, subsequent fetch request may be made.
     * @param {string} key Key to lookup in the database
     * @returns {Promise<Uint8Array>|null} The data corresponding to the key, or null if not found
     */
    async get(key) {
        let hash = this.hash(key),
            hashtableIndex = hash & 255,
            hashtable = this.header[hashtableIndex],
            position = hashtable.position,
            slotCount = hashtable.slotCount,
            slot = (hash >>> 8) % slotCount,
            trueKeyLength = key.length,
            self = this,
            recordHash,
            recordPosition,
            keyLength,
            dataLength;

        if (slotCount === 0) {
            return null;
        }

        async function readSlot(slot) {
            const hashPosition =
                position - self.header[0].position + (slot % slotCount) * 8;
            const hashPositionUint32 = hashPosition / 4;

            recordHash = self.cachedSlots[hashPositionUint32];
            recordPosition = self.cachedSlots[hashPositionUint32 + 1];

            if (recordHash === hash) {
                const r = await fetch(self.file, {
                    headers: {
                        range: `bytes=${recordPosition}-${recordPosition + 7}`
                    }
                });
                const buff = await r.arrayBuffer();
                return await readKey(new Uint32Array(buff));
            } else if (recordHash === 0) {
                return null;
            } else {
                return await readSlot(++slot);
            }
        }

        async function readKey(buffer) {
            keyLength = buffer[0];
            dataLength = buffer[1];

            // In the rare case that there is a hash collision, check the key size
            // to prevent reading in a key that will definitely not match.
            if (keyLength !== trueKeyLength) {
                return await readSlot(++slot);
            }

            const start = recordPosition + 8;
            const r = await fetch(self.file, {
                headers: {
                    range: `bytes=${start}-${
                        start + keyLength + dataLength - 1
                    }`
                }
            });
            return await process(await r.arrayBuffer());
        }

        async function process(buffer) {
            const buffString = new TextDecoder().decode(
                buffer.slice(0, keyLength)
            );
            if (buffString === key) {
                return new Uint8Array(buffer.slice(keyLength));
            } else {
                return await readSlot(++slot);
            }
        }

        return await readSlot(slot);
    }
}
