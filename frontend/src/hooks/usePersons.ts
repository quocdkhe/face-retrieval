import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { personKeys, personsApi } from '@/api/persons'
import type { PersonListParams } from '@/types/person'

export function usePersons(params: PersonListParams) {
  return useQuery({
    queryKey: personKeys.list(params),
    queryFn: () => personsApi.list(params),
    placeholderData: (prev) => prev,
  })
}

export function usePerson(id: number | null) {
  return useQuery({
    queryKey: personKeys.detail(id ?? 0),
    queryFn: () => personsApi.detail(id as number),
    enabled: id !== null,
  })
}

export function useCreatePerson() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: personsApi.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: personKeys.all }),
  })
}

export function useDeletePerson() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: personsApi.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: personKeys.all }),
  })
}
