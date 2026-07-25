/** 简历原件本地存储：IndexedDB（库 hireflow-files / store resumes，key=resumeId）
 *  原件仅保存在本机浏览器，不参与云端同步。所有 API 均 try/catch 兜底，
 *  隐私模式等 IndexedDB 不可用场景下静默降级（返回 null / false）。
 */

const DB_NAME = 'hireflow-files'
const STORE = 'resumes'

export interface StoredResumeFile {
  blob: Blob
  name: string
  type: string
}

interface FileRecord extends StoredResumeFile {
  id: string
  savedAt: number
}

/** 当前环境是否支持 IndexedDB */
export function fileStoreSupported(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!fileStoreSupported()) return resolve(null)
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        try {
          if (!req.result.objectStoreNames.contains(STORE)) {
            req.result.createObjectStore(STORE, { keyPath: 'id' })
          }
        } catch {
          // ignore
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** 保存简历原件（覆盖同 resumeId 的旧记录）；成功返回 true */
export async function saveResumeFile(resumeId: string, file: File | Blob, name?: string, type?: string): Promise<boolean> {
  try {
    const db = await openDb()
    if (!db) return false
    const record: FileRecord = {
      id: resumeId,
      blob: file,
      name: name ?? (file instanceof File ? file.name : '简历原件'),
      type: type ?? file.type ?? '',
      savedAt: Date.now(),
    }
    return await new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(record)
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => resolve(false)
        tx.onabort = () => resolve(false)
      } catch {
        resolve(false)
      }
    })
  } catch {
    return false
  }
}

/** 读取简历原件；不存在或不可用返回 null */
export async function getResumeFile(resumeId: string): Promise<StoredResumeFile | null> {
  try {
    const db = await openDb()
    if (!db) return null
    return await new Promise<StoredResumeFile | null>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).get(resumeId)
        req.onsuccess = () => {
          const rec = req.result as FileRecord | undefined
          resolve(rec ? { blob: rec.blob, name: rec.name, type: rec.type } : null)
        }
        req.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  } catch {
    return null
  }
}

/** 删除简历原件（忽略失败） */
export async function deleteResumeFile(resumeId: string): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).delete(resumeId)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
        tx.onabort = () => resolve()
      } catch {
        resolve()
      }
    })
  } catch {
    // ignore
  }
}
