/**
 * 老式二进制 Word（.doc, OLE2/CFB 格式）浏览器端文本提取。
 *
 * 复用 word-extractor 的 OLE 解析器（word-ole-extractor），但绕过其
 * StorageStream（Node Readable）读取路径——vite 的 stream polyfill 在
 * 浏览器里不会推进 flowing 模式，导致 streamBuffer 的 Promise 永远挂起。
 * 这里用「直接按扇区链顺序读取」的方式替代流式读取，效果等价。
 */

import WordOleExtractor from 'word-extractor/lib/word-ole-extractor.js'
import { Buffer } from 'buffer'

/** word-extractor 内部 reader 接口（与包内 BufferReader 等价，但基于 Uint8Array，避免 Buffer.copy 差异） */
class Uint8ArrayReader {
  private readonly view: Uint8Array

  constructor(view: Uint8Array) {
    this.view = view
  }

  open(): Promise<void> {
    return Promise.resolve()
  }

  close(): Promise<void> {
    return Promise.resolve()
  }

  /** 与 BufferReader.read 同签名：把 position 起的 length 字节写入 buffer 的 offset 处 */
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<Uint8Array> {
    buffer.set(this.view.subarray(position, position + length), offset)
    return Promise.resolve(buffer)
  }
}

/** StorageStream 实例上与本提取相关的内部字段（word-extractor 内部结构） */
interface StorageStreamLike {
  _bytes: number
  _secIds: number[]
  _readSector(sector: number): Promise<Uint8Array>
}

/** 覆盖 streamBuffer：跳过 Node Readable，按扇区链直接读完整流（与 StorageStream._read 的分片/截断逻辑一致） */
class BrowserOleExtractor extends WordOleExtractor {
  async streamBuffer(stream: StorageStreamLike): Promise<Buffer> {
    const chunks: Uint8Array[] = []
    let remaining = stream._bytes
    for (const secId of stream._secIds) {
      let sector = await stream._readSector(secId)
      if (remaining - sector.length < 0) sector = sector.subarray(0, remaining)
      chunks.push(sector)
      remaining -= sector.length
    }
    const total = chunks.reduce((n, c) => n + c.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const c of chunks) {
      out.set(c, offset)
      offset += c.length
    }
    // 返回值会进入 word-extractor 的 Buffer 只读路径（readUIntLE 等），必须是 Buffer
    return Buffer.from(out)
  }
}

/**
 * 提取 .doc 正文纯文本；非 OLE 格式（如实为 .docx 改名）抛出中文错误提示。
 */
export async function extractLegacyDocText(buffer: ArrayBuffer): Promise<string> {
  const view = new Uint8Array(buffer)
  // OLE2 魔数 D0 CF（与 word-extractor word.js 的 sniff 一致）；PK 开头说明实际是 zip/.docx
  if (view.length < 2 || view[0] !== 0xd0 || view[1] !== 0xcf) {
    if (view.length >= 2 && view[0] === 0x50 && view[1] === 0x4b) {
      throw new Error('该文件实际是 .docx（zip）格式，请把扩展名改为 .docx 后重新上传')
    }
    throw new Error('无法识别的 .doc 文件（不是合法的 Word 二进制格式）')
  }
  const reader = new Uint8ArrayReader(view)
  try {
    await reader.open()
    const doc = await new BrowserOleExtractor().extract(reader)
    return doc.getBody()
  } finally {
    await reader.close()
  }
}
