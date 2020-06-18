import { randomBytes } from 'crypto';
import { inject, injectable } from 'inversify';
import * as Lowdb from 'lowdb';
import * as FileSync from 'lowdb/adapters/FileSync';
import * as path from 'path';
import { IFileSystem } from '../../common/platform/types';
import { IExtensionContext } from '../../common/types';
import { IDigestStorage } from '../types';

type DigestEntry = {
    signature: string;
    algorithm: string;
    timestamp: string;
};
type Schema = {
    nbsignatures: DigestEntry[];
};

// NB: still need to implement automatic culling of least recently used entries
@injectable()
export class DigestStorage implements IDigestStorage {
    public get key() {
        return this._key!;
    }
    private defaultDatabaseLocation: string;
    private db: Lowdb.LowdbSync<Schema> | undefined;
    private _key: string | undefined;

    constructor(
        @inject(IFileSystem) private fs: IFileSystem,
        @inject(IExtensionContext) private extensionContext: IExtensionContext
    ) {
        this.defaultDatabaseLocation = this.getDefaultDatabaseLocation();
    }

    public saveDigest(signature: string, algorithm: string) {
        this.initDb();
        this.db!.get('nbsignatures').push({ signature, algorithm, timestamp: Date.now().toString() }).write();
    }

    public containsDigest(signature: string, algorithm: string) {
        this.initDb();
        const val = this.db!.get('nbsignatures').find({ signature, algorithm }).value();
        return val !== undefined;
    }

    /**
     * Get or create a local secret key, used in computing HMAC hashes of trusted
     * checkpoints in the notebook's execution history
     */
    public async initKey() {
        if (this._key === undefined) {
            // Determine user's OS
            const defaultKeyFileLocation = this.getDefaultKeyFileLocation();

            // Attempt to read from standard keyfile location for that OS
            if (await this.fs.fileExists(defaultKeyFileLocation)) {
                this._key = await this.fs.readFile(defaultKeyFileLocation);
            } else {
                // If it doesn't exist, create one
                // Key must be generated from a cryptographically secure pseudorandom function:
                // https://nodejs.org/api/crypto.html#crypto_crypto_randombytes_size_callback
                // No callback is provided so random bytes will be generated synchronously
                const key = randomBytes(1024).toString('hex');
                await this.fs.writeFile(defaultKeyFileLocation, key);
                this._key = key;
            }
        }
    }

    private initDb() {
        if (this.db === undefined) {
            const adapter = new FileSync<Schema>(this.defaultDatabaseLocation);
            this.db = Lowdb(adapter);
            if (this.db.get('nbsignatures') === undefined) {
                this.db.defaults({ nbsignatures: [] }).write();
            }
        }
    }

    private getDefaultDatabaseLocation() {
        const dbName = 'nbsignatures.json';
        const dir = this.extensionContext.globalStoragePath;
        if (dir) {
            return path.join(dir, dbName);
        }
        throw new Error('Unable to locate database');
    }

    private getDefaultKeyFileLocation() {
        const keyfileName = 'nbsecret';
        const dir = this.extensionContext.globalStoragePath;
        if (dir) {
            return path.join(dir, keyfileName);
        }
        throw new Error('Unable to locate keyfile');
    }
}
