import { Layout, Typography } from 'antd'

import FaceExtractPage from '@/pages/FaceExtractPage'

export default function App() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ display: 'flex', alignItems: 'center' }}>
        <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>
          Face Retrieval
        </Typography.Title>
      </Layout.Header>
      <Layout.Content style={{ padding: 24, maxWidth: 1100, width: '100%', margin: '0 auto' }}>
        <FaceExtractPage />
      </Layout.Content>
      <Layout.Footer style={{ textAlign: 'center' }}>
        FastAPI · React · Vite · Ant Design · TanStack Query
      </Layout.Footer>
    </Layout>
  )
}
