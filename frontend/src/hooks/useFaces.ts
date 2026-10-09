import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { facesApi } from '@/api/faces'

export function useExtractFaces() {
  return useMutation({
    mutationFn: facesApi.extract,
  })
}

export function useImageList(params: { limit: number; offset: number }) {
  return useQuery({
    queryKey: ['faces', params],
    queryFn: () => facesApi.list(params),
  })
}

export function useIngestFaces() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: facesApi.ingest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faces'] })
    },
  })
}

export function useDeleteImage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: facesApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faces'] })
    },
  })
}
