const DATABASE_NAME = 'picture-array'
const LEGACY_DATABASE_NAME = 'paper-grid-studio'
const DATABASE_VERSION = 2
const WORKSPACE_STORE = 'workspace-templates'
const WORKSPACE_SUMMARY_STORE = 'workspace-template-summaries'

export type WorkspaceTemplateSummary = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  assetCount: number
  rows: number
  columns: number
  byteSize: number
}

export type WorkspaceTemplateRecord<T> = WorkspaceTemplateSummary & {
  snapshot: T
}

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase() {
  databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) {
        database.createObjectStore(WORKSPACE_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(WORKSPACE_SUMMARY_STORE)) {
        const summaryStore = database.createObjectStore(WORKSPACE_SUMMARY_STORE, { keyPath: 'id' })
        summaryStore.createIndex('updatedAt', 'updatedAt')
        summaryStore.createIndex('name', 'name')

        if (request.transaction && database.objectStoreNames.contains(WORKSPACE_STORE)) {
          const sourceStore = request.transaction.objectStore(WORKSPACE_STORE)
          const cursorRequest = sourceStore.openCursor()
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result
            if (!cursor) return
            const { snapshot: _snapshot, ...summary } = cursor.value as WorkspaceTemplateRecord<unknown>
            summaryStore.put(summary)
            cursor.continue()
          }
        }
      }
    }
    request.onsuccess = () => {
      const database = request.result
      void migrateLegacyDatabase(database).then(
        () => resolve(database),
        () => resolve(database),
      )
    }
    request.onerror = () => reject(request.error ?? new Error('工作空间数据库打开失败'))
    request.onblocked = () => reject(new Error('工作空间数据库正在被其他页面占用'))
  })
  return databasePromise
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('工作空间数据库操作失败'))
  })
}

function transactionFinished(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('工作空间数据库迁移失败'))
    transaction.onabort = () => reject(transaction.error ?? new Error('工作空间数据库迁移已中止'))
  })
}

async function legacyDatabaseExists() {
  if (typeof window.indexedDB.databases !== 'function') return false
  try {
    const databases = await window.indexedDB.databases()
    return databases.some((database) => database.name === LEGACY_DATABASE_NAME)
  } catch {
    return false
  }
}

function openLegacyDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(LEGACY_DATABASE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('旧版工作空间数据库打开失败'))
  })
}

async function migrateLegacyDatabase(targetDatabase: IDBDatabase) {
  if (!(await legacyDatabaseExists())) return
  const targetCount = await requestResult(
    targetDatabase.transaction(WORKSPACE_STORE, 'readonly').objectStore(WORKSPACE_STORE).count(),
  )
  if (targetCount > 0) return

  const legacyDatabase = await openLegacyDatabase()
  try {
    if (!legacyDatabase.objectStoreNames.contains(WORKSPACE_STORE)) return
    const legacyRecords = await requestResult(
      legacyDatabase.transaction(WORKSPACE_STORE, 'readonly').objectStore(WORKSPACE_STORE).getAll(),
    ) as WorkspaceTemplateRecord<unknown>[]
    if (!legacyRecords.length) return

    const transaction = targetDatabase.transaction(
      [WORKSPACE_STORE, WORKSPACE_SUMMARY_STORE],
      'readwrite',
    )
    const completion = transactionFinished(transaction)
    legacyRecords.forEach((record) => {
      const { snapshot: _snapshot, ...summary } = record
      transaction.objectStore(WORKSPACE_STORE).put(record)
      transaction.objectStore(WORKSPACE_SUMMARY_STORE).put(summary)
    })
    await completion
  } finally {
    legacyDatabase.close()
  }
}

export async function listWorkspaceTemplates(): Promise<WorkspaceTemplateSummary[]> {
  const database = await openDatabase()
  const records = await requestResult(
    database.transaction(WORKSPACE_SUMMARY_STORE, 'readonly').objectStore(WORKSPACE_SUMMARY_STORE).getAll(),
  ) as WorkspaceTemplateSummary[]
  return records.sort((left, right) => right.updatedAt - left.updatedAt)
}

export async function getWorkspaceTemplate<T>(id: string) {
  const database = await openDatabase()
  const record = await requestResult(
    database.transaction(WORKSPACE_STORE, 'readonly').objectStore(WORKSPACE_STORE).get(id),
  ) as WorkspaceTemplateRecord<T> | undefined
  return record ?? null
}

export async function saveWorkspaceTemplate<T>(record: WorkspaceTemplateRecord<T>) {
  const database = await openDatabase()
  const transaction = database.transaction(
    [WORKSPACE_STORE, WORKSPACE_SUMMARY_STORE],
    'readwrite',
  )
  const { snapshot: _snapshot, ...summary } = record
  await Promise.all([
    requestResult(transaction.objectStore(WORKSPACE_STORE).put(record)),
    requestResult(transaction.objectStore(WORKSPACE_SUMMARY_STORE).put(summary)),
  ])
}

export async function deleteWorkspaceTemplate(id: string) {
  const database = await openDatabase()
  const transaction = database.transaction(
    [WORKSPACE_STORE, WORKSPACE_SUMMARY_STORE],
    'readwrite',
  )
  await Promise.all([
    requestResult(transaction.objectStore(WORKSPACE_STORE).delete(id)),
    requestResult(transaction.objectStore(WORKSPACE_SUMMARY_STORE).delete(id)),
  ])
}
