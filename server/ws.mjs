/* 零依赖 WebSocket 帧编解码（RFC6455 文本帧） */
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

export function encodeText(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

export function encodePing(data = Buffer.alloc(0)) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  const header = Buffer.alloc(2);
  header[0] = 0x89;
  header[1] = payload.length;
  return Buffer.concat([header, payload]);
}

export function decodeFrames(buf) {
  const out = [];
  let i = 0;
  while (i + 2 <= buf.length) {
    const b0 = buf[i];
    const b1 = buf[i + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let off = i + 2;
    if (len === 126) {
      if (off + 2 > buf.length) break;
      len = buf.readUInt16BE(off);
      off += 2;
    } else if (len === 127) {
      if (off + 8 > buf.length) break;
      len = Number(buf.readBigUInt64BE(off));
      off += 8;
    }
    const maskOff = masked ? off : -1;
    if (masked) off += 4;
    if (off + len > buf.length) break;
    let payload = buf.subarray(off, off + len);
    if (masked) {
      const mask = buf.subarray(maskOff, maskOff + 4);
      const copy = Buffer.alloc(len);
      for (let j = 0; j < len; j++) copy[j] = payload[j] ^ mask[j % 4];
      payload = copy;
    }
    i = off + len;
    if (opcode === 0x8) { out.push({ type: 'close' }); continue; }
    if (opcode === 0x9) { out.push({ type: 'ping', data: payload }); continue; }
    if (opcode === 0xa) { out.push({ type: 'pong', data: payload }); continue; }
    if (opcode === 0x1) out.push({ type: 'text', data: payload.toString('utf8') });
  }
  return { messages: out, rest: buf.subarray(i) };
}

export function attachSocket(socket, onMessage, onClose) {
  let buf = Buffer.alloc(0);
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    onClose();
  };
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { messages, rest } = decodeFrames(buf);
    buf = rest;
    for (const m of messages) {
      if (m.type === 'close') { socket.end(); return; }
      if (m.type === 'ping') {
        const pong = Buffer.alloc(2 + m.data.length);
        pong[0] = 0x8a;
        pong[1] = m.data.length;
        m.data.copy(pong, 2);
        try { socket.write(pong); } catch { /* ignore */ }
        continue;
      }
      if (m.type === 'text') onMessage(m.data);
    }
  });
  socket.on('close', finish);
  socket.on('error', finish);
  return {
    send(obj) {
      if (closed) return false;
      try { socket.write(encodeText(JSON.stringify(obj))); return true; }
      catch { return false; }
    },
    ping() {
      if (closed) return false;
      try { socket.write(encodePing()); return true; }
      catch { return false; }
    },
    close() { try { socket.end(); } catch { /* ignore */ } }
  };
}
