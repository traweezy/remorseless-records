import { AbstractFileProviderService, MedusaError } from '@medusajs/framework/utils';
import { Logger } from '@medusajs/framework/types';
import { 
  ProviderUploadFileDTO,
  ProviderDeleteFileDTO,
  ProviderFileResultDTO,
  ProviderGetFileDTO,
  ProviderGetPresignedUploadUrlDTO
} from '@medusajs/framework/types';
import type { Readable } from 'stream';
import { Client } from 'minio';
import path from 'path';
import { ulid } from 'ulid';

type InjectedDependencies = {
  logger: Logger
}

interface MinioServiceConfig {
  endPoint: string
  accessKey: string
  secretKey: string
  bucket?: string
}

export interface MinioFileProviderOptions {
  endPoint: string
  accessKey: string
  secretKey: string
  bucket?: string
}

const DEFAULT_BUCKET = 'medusa-media'

/**
 * Service to handle file storage using MinIO.
 */
class MinioFileProviderService extends AbstractFileProviderService {
  static override identifier = 'minio-file'
  protected readonly minioConfig: MinioServiceConfig
  protected readonly logger: Logger
  protected readonly bucket: string
  private readonly minioClient: Client

  constructor({ logger }: InjectedDependencies, options: MinioFileProviderOptions) {
    super()
    this.logger = logger
    this.minioConfig = {
      endPoint: options.endPoint,
      accessKey: options.accessKey,
      secretKey: options.secretKey,
      ...(options.bucket ? { bucket: options.bucket } : {})
    }

    // Use provided bucket or default
    this.bucket = this.minioConfig.bucket || DEFAULT_BUCKET
    this.logger.info(`MinIO service initialized with bucket: ${this.bucket}`)

    // Initialize Minio client with hardcoded SSL settings
    this.minioClient = new Client({
      endPoint: this.minioConfig.endPoint,
      port: 443,
      useSSL: true,
      accessKey: this.minioConfig.accessKey,
      secretKey: this.minioConfig.secretKey
    })

    // Initialize bucket and policy
    this.initializeBucket().catch((error: unknown) => {
      const message = getErrorMessage(error)
      this.logger.error(`Failed to initialize MinIO bucket: ${message}`)
    })
  }

  static override validateOptions(options: Record<string, any>) {
    const requiredFields = [
      'endPoint',
      'accessKey',
      'secretKey'
    ]

    requiredFields.forEach((field) => {
      if (!options[field]) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `${field} is required in the provider's options`
        )
      }
    })
  }

  private async initializeBucket(): Promise<void> {
    try {
      // Check if bucket exists
      const bucketExists = await this.minioClient.bucketExists(this.bucket)
      
      if (!bucketExists) {
        // Create the bucket
        await this.minioClient.makeBucket(this.bucket)
        this.logger.info(`Created bucket: ${this.bucket}`)

        // Set bucket policy to allow public read access
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'PublicRead',
              Effect: 'Allow',
              Principal: '*',
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.bucket}/*`]
            }
          ]
        }

        await this.minioClient.setBucketPolicy(this.bucket, JSON.stringify(policy))
        this.logger.info(`Set public read policy for bucket: ${this.bucket}`)
      } else {
        this.logger.info(`Using existing bucket: ${this.bucket}`)
        
        // Verify/update policy on existing bucket
        try {
          const policy = {
            Version: '2012-10-17',
            Statement: [
              {
                Sid: 'PublicRead',
                Effect: 'Allow',
                Principal: '*',
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${this.bucket}/*`]
              }
            ]
          }
          await this.minioClient.setBucketPolicy(this.bucket, JSON.stringify(policy))
          this.logger.info(`Updated public read policy for existing bucket: ${this.bucket}`)
        } catch (policyError: unknown) {
          this.logger.warn(
            `Failed to update policy for existing bucket: ${getErrorMessage(policyError)}`
          )
        }
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error)
      this.logger.error(`Error initializing bucket: ${message}`)
      throw error instanceof Error ? error : new MedusaError(MedusaError.Types.UNEXPECTED_STATE, message)
    }
  }

  override async upload(
    file: ProviderUploadFileDTO
  ): Promise<ProviderFileResultDTO> {
    if (!file) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No file provided'
      )
    }

    if (!file.filename) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No filename provided'
      )
    }

    try {
      const fileKey = this.createFileKey(file.filename)
      const content = Buffer.from(file.content, 'binary')

      // Upload file with public-read access
      await this.minioClient.putObject(
        this.bucket,
        fileKey,
        content,
        content.length,
        {
          'Content-Type': file.mimeType,
          'x-amz-meta-original-filename': file.filename,
          'x-amz-acl': 'public-read'
        }
      )

      this.logger.info(`Successfully uploaded file ${fileKey} to MinIO bucket ${this.bucket}`)

      return {
        url: this.buildFileUrl(fileKey),
        key: fileKey
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error)
      this.logger.error(`Failed to upload file: ${message}`)
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Failed to upload file: ${message}`)
    }
  }

  override async delete(
    fileData: ProviderDeleteFileDTO | ProviderDeleteFileDTO[]
  ): Promise<void> {
    const entries = Array.isArray(fileData) ? fileData : [fileData]

    const serialized = JSON.stringify(fileData)
    this.logger.info?.(
      `[minio][delete] raw payload ${serialized}`
    )

    const keys = entries
      .map((entry) => {
        const resolved = this.resolveFileKey(entry)
        this.logger.info?.(
          `[minio][delete] resolved key ${resolved} from ${serialized}`
        )
        return resolved
      })
      .filter((key): key is string => Boolean(key))

    if (!keys.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No file key provided'
      )
    }

    await Promise.all(
      keys.map(async (fileKey) => {
        try {
          await this.minioClient.removeObject(this.bucket, fileKey)
          this.logger.info(`Successfully deleted file ${fileKey} from MinIO bucket ${this.bucket}`)
        } catch (error: unknown) {
          this.logger.warn(
            `Failed to delete file ${fileKey}: ${getErrorMessage(error)}`
          )
        }
      })
    )
  }

  async getPresignedUploadUrl(
    fileData: ProviderGetPresignedUploadUrlDTO
  ): Promise<ProviderFileResultDTO> {
    if (!fileData?.filename) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No filename provided'
      )
    }

    const fileKey = this.createFileKey(fileData.filename)
    const expiresInSeconds = Math.min(
      Math.max(fileData.expiresIn ?? 300, 1),
      7 * 24 * 60 * 60
    )

    try {
      const url = await this.minioClient.presignedPutObject(
        this.bucket,
        fileKey,
        expiresInSeconds
      )

      this.logger.info(
        `Generated presigned upload URL for file ${fileKey} (expires in ${expiresInSeconds}s)`
      )

      return {
        url,
        key: fileKey
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error)
      this.logger.error(`Failed to generate presigned upload URL: ${message}`)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to generate presigned upload URL: ${message}`
      )
    }
  }

  override async getPresignedDownloadUrl(
    fileData: ProviderGetFileDTO | string
  ): Promise<string> {
    const fileKey = this.resolveFileKey(fileData)

    this.logger.info?.(
      `[minio][download-url] payload=${JSON.stringify(
        fileData
      )} resolved=${fileKey}`
    )

    if (!fileKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No file key provided'
      )
    }

    try {
      const url = await this.minioClient.presignedGetObject(
        this.bucket,
        fileKey,
        24 * 60 * 60 // URL expires in 24 hours
      )
      this.logger.info(`Generated presigned URL for file ${fileKey}`)
      return url
    } catch (error: unknown) {
      const message = getErrorMessage(error)
      this.logger.error(`Failed to generate presigned URL: ${message}`)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to generate presigned URL: ${message}`
      )
    }
  }

  override async getDownloadStream(
    fileData: ProviderGetFileDTO | string
  ): Promise<Readable> {
    const fileKey = this.resolveFileKey(fileData)

    this.logger.info?.(
      `[minio][download-stream] payload=${JSON.stringify(
        fileData
      )} resolved=${fileKey}`
    )

    if (!fileKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No file key provided'
      )
    }

    try {
      return await this.minioClient.getObject(this.bucket, fileKey)
    } catch (error: unknown) {
      const message = getErrorMessage(error)
      this.logger.error(`Failed to retrieve download stream for ${fileKey}: ${message}`)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to retrieve download stream: ${message}`
      )
    }
  }

  override async getAsBuffer(
    fileData: ProviderGetFileDTO | string
  ): Promise<Buffer> {
    const fileKey = this.resolveFileKey(fileData)
    this.logger.info?.(
      `[minio][buffer] payload=${JSON.stringify(fileData)} resolved=${fileKey}`
    )
    const stream = await this.getDownloadStream(fileData)

    return await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []

      stream.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })

      stream.on('error', (error: unknown) => {
        const message = getErrorMessage(error)
        this.logger.error(`Failed to read buffer for ${fileKey}: ${message}`)
        reject(
          new MedusaError(
            MedusaError.Types.UNEXPECTED_STATE,
            `Failed to read file buffer: ${message}`
          )
        )
      })

      stream.on('end', () => {
        resolve(Buffer.concat(chunks))
      })
    })
  }

  private createFileKey(filename: string): string {
    const parsed = path.parse(filename)
    const baseName = parsed.name?.trim() || 'file'
    const sanitized = baseName.replace(/[^\w\-]+/g, '-').replace(/-+/g, '-')
    const extension = parsed.ext ?? ''
    return `${sanitized}-${ulid()}${extension}`
  }

  private buildFileUrl(fileKey: string): string {
    return `https://${this.minioConfig.endPoint}/${this.bucket}/${fileKey}`
  }

  private resolveFileKey(
    fileData: ProviderGetFileDTO | ProviderDeleteFileDTO | string | undefined
  ): string | null {
    if (!fileData) {
      return null
    }

    if (typeof fileData === 'string') {
      return fileData
    }

    const candidate =
      (fileData as ProviderGetFileDTO)?.fileKey ??
      (fileData as ProviderDeleteFileDTO)?.fileKey ??
      (fileData as unknown as { file_key?: string })?.file_key ??
      (fileData as unknown as { key?: string })?.key ??
      null

    return candidate
  }
}

export default MinioFileProviderService

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
