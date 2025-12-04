import * as fs from "node:fs/promises";
import type { Mixedbread } from "@mixedbread/sdk";
import type { Uploadable } from "@mixedbread/sdk/core/uploads";
import type { SearchFilter } from "@mixedbread/sdk/resources/shared";
import type {
  ScoredAudioURLInputChunk,
  ScoredImageURLInputChunk,
  ScoredTextInputChunk,
  ScoredVideoURLInputChunk,
} from "@mixedbread/sdk/resources/vector-stores/vector-stores";

export interface FileMetadata {
  path: string;
  hash: string;
}

export type ChunkType =
  | ScoredTextInputChunk
  | ScoredImageURLInputChunk
  | ScoredAudioURLInputChunk
  | ScoredVideoURLInputChunk;

export interface StoreFile {
  external_id: string | null;
  metadata: FileMetadata | null;
}

export interface UploadFileOptions {
  external_id: string;
  overwrite?: boolean;
  metadata?: FileMetadata;
}

export interface SearchResponse {
  data: ChunkType[];
}

export interface AskResponse {
  answer: string;
  sources: ChunkType[];
}

export interface CreateStoreOptions {
  name: string;
  description?: string;
}

export interface StoreInfo {
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  counts: {
    pending: number;
    in_progress: number;
  };
}

/**
 * Interface for store operations
 */
export interface ListFilesOptions {
  pathPrefix?: string;
}

export interface Store {
  /**
   * List files in a store as an async iterator
   *
   * @param storeId - The ID of the store
   * @param options - Optional filtering options
   * @param options.pathPrefix - Only return files whose path starts with this prefix
   */
  listFiles(
    storeId: string,
    options?: ListFilesOptions,
  ): AsyncGenerator<StoreFile>;

  /**
   * Upload a file to a store
   */
  uploadFile(
    storeId: string,
    file: File | ReadableStream,
    options: UploadFileOptions,
  ): Promise<void>;

  /**
   * Delete a file from a store by its external ID
   */
  deleteFile(storeId: string, externalId: string): Promise<void>;

  /**
   * Search in a store
   */
  search(
    storeId: string,
    query: string,
    top_k?: number,
    search_options?: { rerank?: boolean },
    filters?: SearchFilter,
  ): Promise<SearchResponse>;

  /**
   * Retrieve store information
   */
  retrieve(storeId: string): Promise<unknown>;

  /**
   * Create a new store
   */
  create(options: CreateStoreOptions): Promise<unknown>;

  /**
   * Ask a question to a store
   */
  ask(
    storeId: string,
    question: string,
    top_k?: number,
    search_options?: { rerank?: boolean },
    filters?: SearchFilter,
  ): Promise<AskResponse>;

  /**
   * Get store information
   */
  getInfo(storeId: string): Promise<StoreInfo>;

  /**
   * Refresh the client with a new JWT token (optional, for long-running sessions)
   */
  refreshClient?(): Promise<void>;
}

/**
 * Mixedbread implementation of the Store interface
 */
export class MixedbreadStore implements Store {
  private client: Mixedbread;
  private clientFactory: () => Promise<Mixedbread>;

  constructor(client: Mixedbread, clientFactory: () => Promise<Mixedbread>) {
    this.client = client;
    this.clientFactory = clientFactory;
  }

  async refreshClient(): Promise<void> {
    this.client = await this.clientFactory();
  }

  async *listFiles(
    storeId: string,
    options?: ListFilesOptions,
  ): AsyncGenerator<StoreFile> {
    let after: string | undefined;
    do {
      const response = await this.client.stores.files.list(storeId, {
        limit: 100,
        after,
        metadata_filter: options?.pathPrefix
          ? { key: "path", operator: "starts_with", value: options.pathPrefix }
          : null,
      });

      for (const f of response.data) {
        yield {
          external_id: f.external_id ?? null,
          metadata: (f.metadata || null) as FileMetadata | null,
        };
      }

      after = response.pagination?.has_more
        ? (response.pagination?.last_cursor ?? undefined)
        : undefined;
    } while (after);
  }

  async uploadFile(
    storeId: string,
    file: File | ReadableStream,
    options: UploadFileOptions,
  ): Promise<void> {
    await (
      this.client.stores.files.upload as (
        storeIdentifier: string,
        file: Uploadable,
        body?: {
          external_id?: string | null;
          overwrite?: boolean;
          metadata?: unknown;
        },
      ) => Promise<unknown>
    )(storeId, file as Uploadable, {
      external_id: options.external_id,
      overwrite: options.overwrite ?? true,
      metadata: options.metadata,
    });
  }

  async deleteFile(storeId: string, externalId: string): Promise<void> {
    await this.client.stores.files.delete(externalId, {
      store_identifier: storeId,
    });
  }

  async search(
    storeId: string,
    query: string,
    top_k?: number,
    search_options?: { rerank?: boolean },
    filters?: SearchFilter,
  ): Promise<SearchResponse> {
    const response = await this.client.stores.search({
      query,
      store_identifiers: [storeId],
      top_k,
      search_options,
      filters,
    });

    return {
      data: response.data as ChunkType[],
    };
  }

  async retrieve(storeId: string): Promise<unknown> {
    return await this.client.stores.retrieve(storeId);
  }

  async create(options: CreateStoreOptions): Promise<unknown> {
    return await this.client.stores.create({
      name: options.name,
      description: options.description,
    });
  }

  async ask(
    storeId: string,
    question: string,
    top_k?: number,
    search_options?: { rerank?: boolean },
    filters?: SearchFilter,
  ): Promise<AskResponse> {
    const response = await this.client.stores.questionAnswering({
      query: question,
      store_identifiers: [storeId],
      top_k,
      search_options,
      filters,
    });

    return {
      answer: response.answer,
      sources: response.sources as ChunkType[],
    };
  }

  async getInfo(storeId: string): Promise<StoreInfo> {
    const response = await this.client.stores.retrieve(storeId, {});
    return {
      name: response.name,
      description: response.description ?? "",
      created_at: response.created_at,
      updated_at: response.updated_at,
      counts: {
        pending: response.file_counts?.pending ?? 0,
        in_progress: response.file_counts?.in_progress ?? 0,
      },
    };
  }
}

interface TestStoreDB {
  info: StoreInfo;
  files: Record<
    string,
    {
      metadata: FileMetadata;
      content: string;
    }
  >;
}

export class TestStore implements Store {
  path: string;
  private mutex: Promise<void> = Promise.resolve();

  constructor() {
    const path = process.env.MGREP_TEST_STORE_PATH;
    if (!path) {
      throw new Error("MGREP_TEST_STORE_PATH is not set");
    }
    this.path = path;
  }

  private async synchronized<T>(fn: () => Promise<T>): Promise<T> {
    let unlock: () => void = () => {};
    const newLock = new Promise<void>((resolve) => {
      unlock = resolve;
    });

    const previousLock = this.mutex;
    this.mutex = newLock;

    await previousLock;

    try {
      return await fn();
    } finally {
      unlock();
    }
  }

  private async load(): Promise<TestStoreDB> {
    try {
      const content = await fs.readFile(this.path, "utf-8");
      return JSON.parse(content);
    } catch {
      return {
        info: {
          name: "Test Store",
          description: "A test store",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          counts: { pending: 0, in_progress: 0 },
        },
        files: {},
      };
    }
  }

  private async save(data: TestStoreDB): Promise<void> {
    await fs.writeFile(this.path, JSON.stringify(data, null, 2));
  }

  private async readContent(file: File | ReadableStream): Promise<string> {
    if (
      "text" in file &&
      typeof (file as { text: unknown }).text === "function"
    ) {
      return await (file as File).text();
    }

    const chunks: Buffer[] = [];
    if (
      typeof (file as unknown as AsyncIterable<unknown>)[
        Symbol.asyncIterator
      ] === "function"
    ) {
      for await (const chunk of file as unknown as AsyncIterable<
        Uint8Array | string
      >) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString("utf-8");
    }

    if ("getReader" in file) {
      const reader = (file as ReadableStream).getReader();
      const decoder = new TextDecoder();
      let res = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res += decoder.decode(value, { stream: true });
      }
      res += decoder.decode();
      return res;
    }

    throw new Error("Unknown file type");
  }

  async *listFiles(
    _storeId: string,
    options?: ListFilesOptions,
  ): AsyncGenerator<StoreFile> {
    const db = await this.load();
    for (const [external_id, file] of Object.entries(db.files)) {
      if (
        options?.pathPrefix &&
        file.metadata?.path &&
        !file.metadata.path.startsWith(options.pathPrefix)
      ) {
        continue;
      }
      yield {
        external_id,
        metadata: file.metadata,
      };
    }
  }

  async uploadFile(
    _storeId: string,
    file: File | ReadableStream,
    options: UploadFileOptions,
  ): Promise<void> {
    const content = await this.readContent(file);
    await this.synchronized(async () => {
      const db = await this.load();
      db.files[options.external_id] = {
        metadata: options.metadata || { path: options.external_id, hash: "" },
        content,
      };
      await this.save(db);
    });
  }

  async deleteFile(_storeId: string, externalId: string): Promise<void> {
    await this.synchronized(async () => {
      const db = await this.load();
      delete db.files[externalId];
      await this.save(db);
    });
  }

  async search(
    _storeId: string,
    query: string,
    top_k?: number,
    search_options?: { rerank?: boolean },
    filters?: SearchFilter,
  ): Promise<SearchResponse> {
    const db = await this.load();
    const results: ChunkType[] = [];
    const limit = top_k || 10;

    for (const file of Object.values(db.files)) {
      if (filters?.all) {
        const pathFilter = filters.all.find(
          (f) => "key" in f && f.key === "path" && f.operator === "starts_with",
        );
        if (
          pathFilter &&
          "value" in pathFilter &&
          file.metadata &&
          !file.metadata.path.startsWith(pathFilter.value as string)
        ) {
          continue;
        }
      }

      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(query.toLowerCase())) {
          results.push({
            type: "text",
            text:
              lines[i] + (search_options?.rerank ? "" : " without reranking"),
            score: 1.0,
            metadata: file.metadata,
            chunk_index: results.length - 1,
            generated_metadata: {
              start_line: i,
              num_lines: 1,
            },
          } as unknown as ChunkType);
          if (results.length >= limit) break;
        }
      }
      if (results.length >= limit) break;
    }

    return { data: results };
  }

  async retrieve(_storeId: string): Promise<unknown> {
    const db = await this.load();
    return db.info;
  }

  async create(options: CreateStoreOptions): Promise<unknown> {
    return await this.synchronized(async () => {
      const db = await this.load();
      db.info.name = options.name;
      db.info.description = options.description || "";
      await this.save(db);
      return db.info;
    });
  }

  async ask(
    storeId: string,
    question: string,
    top_k?: number,
    search_options?: { rerank?: boolean },
    filters?: SearchFilter,
  ): Promise<AskResponse> {
    const searchRes = await this.search(
      storeId,
      question,
      top_k,
      search_options,
      filters,
    );
    return {
      answer: 'This is a mock answer from TestStore.<cite i="0" />',
      sources: searchRes.data,
    };
  }

  async getInfo(_storeId: string): Promise<StoreInfo> {
    const db = await this.load();
    return db.info;
  }
}
