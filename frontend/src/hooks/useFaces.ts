import { useMutation } from '@tanstack/react-query'

import { facesApi } from '@/api/faces'

export function useExtractFaces() {
  return useMutation({
    mutationFn: facesApi.extract,
  })
}
