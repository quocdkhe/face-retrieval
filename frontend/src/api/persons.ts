import { http } from '@/lib/axios'
import type {
  Person,
  PersonCreate,
  PersonListParams,
  PersonPage,
} from '@/types/person'

export const personsApi = {
  list: async (params: PersonListParams): Promise<PersonPage> => {
    const { data } = await http.get<PersonPage>('/persons', { params })
    return data
  },

  detail: async (id: number): Promise<Person> => {
    const { data } = await http.get<Person>(`/persons/${id}`)
    return data
  },

  create: async (payload: PersonCreate): Promise<Person> => {
    const { data } = await http.post<Person>('/persons', payload)
    return data
  },

  remove: async (id: number): Promise<void> => {
    await http.delete(`/persons/${id}`)
  },
}

export const personKeys = {
  all: ['persons'] as const,
  list: (params: PersonListParams) => [...personKeys.all, 'list', params] as const,
  detail: (id: number) => [...personKeys.all, 'detail', id] as const,
}
