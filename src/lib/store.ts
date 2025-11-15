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

export interface CreateStoreOptions {
  name: string;
  description?: string;
}

/**
 * Interface for store operations
 */
export interface Store {
  /**
   * List files in a store as an async iterator
   */
  listFiles(storeId: string): AsyncGenerator<StoreFile>;

  /**
   * Upload a file to a store
   */
  uploadFile(
    storeId: string,
    file: File | ReadableStream,
    options: UploadFileOptions,
  ): Promise<void>;

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
}

/**
 * Mixedbread implementation of the Store interface
 */
export class MixedbreadStore implements Store {
  constructor(private client: Mixedbread) {}

  async *listFiles(storeId: string): AsyncGenerator<StoreFile> {
    let after: string | undefined;
    do {
      const response = await this.client.stores.files.list(storeId, {
        limit: 100,
        after,
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
}
