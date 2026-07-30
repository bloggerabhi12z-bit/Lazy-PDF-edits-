let pendingFiles: File[] = [];

export function stageFiles(files: File[]) {
  pendingFiles = files;
}

export function takeStagedFiles() {
  const files = pendingFiles;
  pendingFiles = [];
  return files;
}
