import { Layout, Menu, Typography } from 'antd'
import { Link, Route, Routes, useLocation } from 'react-router-dom'

import FaceDatabasePage from '@/pages/FaceDatabasePage'
import FaceExtractPage from '@/pages/FaceExtractPage'

const NAV_ITEMS = [
  { key: '/', label: <Link to="/">Face Database</Link> },
  { key: '/extract', label: <Link to="/extract">Trích xuất thử</Link> },
]

export default function App() {
  const { pathname } = useLocation()

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <Typography.Title level={4} style={{ color: '#fff', margin: 0, whiteSpace: 'nowrap' }}>
          Face Retrieval
        </Typography.Title>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[pathname]}
          items={NAV_ITEMS}
          style={{ flex: 1, minWidth: 0 }}
        />
      </Layout.Header>
      <Layout.Content style={{ padding: 24, maxWidth: 1100, width: '100%', margin: '0 auto' }}>
        <Routes>
          <Route path="/" element={<FaceDatabasePage />} />
          <Route path="/extract" element={<FaceExtractPage />} />
        </Routes>
      </Layout.Content>
      <Layout.Footer style={{ textAlign: 'center' }}>
        FastAPI · React · Vite · Ant Design · TanStack Query
      </Layout.Footer>
    </Layout>
  )
}
