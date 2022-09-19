/**
 * CDB hash function
 * @param {string} key Key to hash
 * @returns {number} Hash
 */
export function cdbHash(key: string): number;
export type cdbHashFunction = (key: string) => number;

export default class StreamingCDB {

    /**
     * Stream a CDB file over HTTP using fetch
     * @param {string} file URL of the CDB file to stream
     * @param {Function} hasher Optional custom hash function to use
     */
    constructor(file: string, hasher: cdbHashFunction);

    /**
     * Open the CDB file for reading. This causes the CDB file's header and
     * trailing hash table to be read with two sequential fetch requests.
     */
    public async open(): Promise<void>;

    /**
     * Retrieve a stored value by key. Typically, this requires two sequential fetch requests, one to
     * find the record entry (key/data length), the other to read the stored data. In the rare even
     * of a hash collision, subsequent fetch request may be made.
     * @param {string} key Key to lookup in the database
     * @returns {Promise<Uint8Array>|null} The data corresponding to the key, or null if not found
     */
    public async get(key: string): Promise<Uint8Array> | null;
}