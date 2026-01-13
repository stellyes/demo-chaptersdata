'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, Check, X, Loader2 } from 'lucide-react';

interface FileUploadProps {
  onUpload: (file: File) => Promise<void>;
  accept?: Record<string, string[]>;
  maxSize?: number;
  title?: string;
  description?: string;
}

export function FileUpload({
  onUpload,
  accept = { 'text/csv': ['.csv'], 'application/vnd.ms-excel': ['.xls', '.xlsx'] },
  maxSize = 500 * 1024 * 1024, // 500MB
  title = 'Drop files here or click to browse',
  description = 'Supports CSV and Excel files up to 500MB',
}: FileUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      const file = acceptedFiles[0];
      setUploading(true);
      setUploadStatus('idle');
      setErrorMessage('');

      try {
        await onUpload(file);
        setUploadStatus('success');
      } catch (error) {
        setUploadStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [onUpload]
  );

  const { getRootProps, getInputProps, isDragActive, acceptedFiles } = useDropzone({
    onDrop,
    accept,
    maxSize,
    multiple: false,
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg py-12 px-8 text-center cursor-pointer transition-all duration-300 ${
        isDragActive
          ? 'border-[var(--accent)] bg-[var(--accent)]/5'
          : 'border-[var(--border)] bg-[var(--paper)]'
      }`}
    >
      <input {...getInputProps()} />

      <div className="w-16 h-16 rounded-full bg-[var(--accent)]/15 flex items-center justify-center mx-auto mb-4">
        {uploading ? (
          <Loader2 className="w-7 h-7 text-[var(--accent)] animate-spin" />
        ) : uploadStatus === 'success' ? (
          <Check className="w-7 h-7 text-[var(--success)]" />
        ) : uploadStatus === 'error' ? (
          <X className="w-7 h-7 text-[var(--error)]" />
        ) : (
          <Upload className="w-7 h-7 text-[var(--accent)]" />
        )}
      </div>

      <p className="font-serif text-xl text-[var(--ink)] mb-2 font-medium">{title}</p>
      <p className="text-[var(--muted)] text-sm mb-4">{description}</p>

      {acceptedFiles.length > 0 && (
        <div className="flex items-center justify-center gap-2 text-sm text-[var(--ink)]">
          <FileText className="w-4 h-4" />
          <span>{acceptedFiles[0].name}</span>
        </div>
      )}

      {errorMessage && (
        <p className="text-[var(--error)] text-sm mt-2">{errorMessage}</p>
      )}

      {uploadStatus === 'success' && (
        <p className="text-[var(--success)] text-sm mt-2">File uploaded successfully!</p>
      )}
    </div>
  );
}
