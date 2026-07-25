/** word-extractor 无官方类型声明：按实际用到的 API 面声明（老式 .doc 二进制 Word 文本提取） */
declare module 'word-extractor' {
  import type { Buffer } from 'buffer'

  interface ExtractedDoc {
    getBody(): string
    getFootnotes(): string
    getHeaders(): string
    getAnnotations(): string
    getEndnotes(): string
  }

  export default class WordExtractor {
    extract(doc: Buffer | string): Promise<ExtractedDoc>
  }
}

declare module 'word-extractor/lib/word-ole-extractor.js' {
  import type { Buffer } from 'buffer'

  interface ExtractedDoc {
    getBody(): string
    getFootnotes(): string
    getHeaders(): string
    getAnnotations(): string
    getEndnotes(): string
  }

  /** reader 接口与包内 BufferReader 等价 */
  interface ReaderLike {
    open(): Promise<unknown>
    close(): Promise<unknown>
    read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<unknown>
  }

  export default class WordOleExtractor {
    extract(reader: ReaderLike): Promise<ExtractedDoc>
    /** 读取流完整内容为 Buffer（浏览器端会覆盖此方法绕过 Node Readable） */
    streamBuffer(stream: unknown): Promise<Buffer>
  }
}
