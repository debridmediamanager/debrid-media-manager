export async function torrentFileToMagnetHash(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const buffer = e.target?.result as ArrayBuffer;
                const array = new Uint8Array(buffer);
                const decodedInfo = decodeTorrent(array);
                const infoHash = decodedInfo.infoHash;
                resolve(infoHash);
            } catch (error) {
                reject(new Error('Failed to parse torrent file'));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
    });
}

function decodeTorrent(data: Uint8Array): { infoHash: string } {
    // Basic bencode parser for .torrent files
    let pos = 0;
    
    function readString(len: number): string {
        const str = new TextDecoder().decode(data.slice(pos, pos + len));
        pos += len;
        return str;
    }

    function readInt(): number {
        let num = 0;
        while (data[pos] >= 48 && data[pos] <= 57) {
            num = num * 10 + (data[pos] - 48);
            pos++;
        }
        return num;
    }

    function readValue(): any {
        const char = data[pos];
        if (char === 100) { // 'd' for dictionary
            pos++;
            const dict: any = {};
            while (data[pos] !== 101) { // 'e' for end
                const keyLen = readInt();
                pos++; // skip colon
                const key = readString(keyLen);
                dict[key] = readValue();
            }
            pos++; // skip 'e'
            return dict;
        } else if (char === 108) { // 'l' for list
            pos++;
            const list = [];
            while (data[pos] !== 101) { // 'e' for end
                list.push(readValue());
            }
            pos++; // skip 'e'
            return list;
        } else if (char === 105) { // 'i' for integer
            pos++;
            const num = readInt();
            pos++; // skip 'e'
            return num;
        } else {
            const len = readInt();
            pos++; // skip colon
            return readString(len);
        }
    }

    const torrent = readValue();
    
    // Calculate info hash
    const info = torrent.info;
    const infoBuffer = new TextEncoder().encode(JSON.stringify(info));
    return {
        infoHash: sha1(infoBuffer)
    };
}

function sha1(data: Uint8Array): string {
    let h0 = 0x67452301;
    let h1 = 0xEFCDAB89;
    let h2 = 0x98BADCFE;
    let h3 = 0x10325476;
    let h4 = 0xC3D2E1F0;

    // Pad the message
    const bitLength = data.length * 8;
    const padding = new Uint8Array(64 - (data.length + 9) % 64 + 9);
    padding[0] = 0x80;
    for (let i = 0; i < 8; i++) {
        padding[padding.length - 1 - i] = bitLength >>> (i * 8) & 0xFF;
    }

    const chunks = new Uint8Array(data.length + padding.length);
    chunks.set(data);
    chunks.set(padding, data.length);

    // Process chunks
    for (let i = 0; i < chunks.length; i += 64) {
        const w = new Uint32Array(80);
        
        // Copy chunk into first 16 words
        for (let j = 0; j < 16; j++) {
            w[j] = (chunks[i + j*4] << 24) | 
                   (chunks[i + j*4 + 1] << 16) |
                   (chunks[i + j*4 + 2] << 8) |
                   chunks[i + j*4 + 3];
        }

        // Extend the sixteen 32-bit words into eighty 32-bit words
        for (let j = 16; j < 80; j++) {
            w[j] = rotateLeft(w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16], 1);
        }

        let a = h0;
        let b = h1;
        let c = h2;
        let d = h3;
        let e = h4;

        for (let j = 0; j < 80; j++) {
            let f, k;
            if (j < 20) {
                f = (b & c) | ((~b) & d);
                k = 0x5A827999;
            } else if (j < 40) {
                f = b ^ c ^ d;
                k = 0x6ED9EBA1;
            } else if (j < 60) {
                f = (b & c) | (b & d) | (c & d);
                k = 0x8F1BBCDC;
            } else {
                f = b ^ c ^ d;
                k = 0xCA62C1D6;
            }

            const temp = (rotateLeft(a, 5) + f + e + k + w[j]) >>> 0;
            e = d;
            d = c;
            c = rotateLeft(b, 30);
            b = a;
            a = temp;
        }

        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
    }

    // Convert to hex string
    return [h0, h1, h2, h3, h4]
        .map(h => h.toString(16).padStart(8, '0'))
        .join('');
}

function rotateLeft(n: number, s: number): number {
    return ((n << s) | (n >>> (32 - s))) >>> 0;
}
