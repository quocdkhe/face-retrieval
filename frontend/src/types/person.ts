export interface Person {
  id: number
  name: string
  email: string
  avatar_url: string | null
  created_at: string
}

export interface PersonCreate {
  name: string
  email: string
  avatar_url?: string | null
}

export interface PersonPage {
  items: Person[]
  total: number
  page: number
  page_size: number
}

export interface PersonListParams {
  q?: string
  page?: number
  page_size?: number
}
