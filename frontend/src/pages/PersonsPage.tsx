import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  App,
  Avatar,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'

import { useCreatePerson, useDeletePerson, usePersons } from '@/hooks/usePersons'
import type { Person, PersonCreate } from '@/types/person'

export default function PersonsPage() {
  const { message } = App.useApp()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form] = Form.useForm<PersonCreate>()

  const { data, isPending, isFetching, isError, error, refetch } = usePersons({
    q: search || undefined,
    page,
    page_size: pageSize,
  })

  const createPerson = useCreatePerson()
  const deletePerson = useDeletePerson()

  const handleCreate = async () => {
    const values = await form.validateFields()
    try {
      await createPerson.mutateAsync(values)
      message.success('Đã thêm person mới')
      setIsModalOpen(false)
      form.resetFields()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Tạo thất bại')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deletePerson.mutateAsync(id)
      message.success('Đã xoá')
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Xoá thất bại')
    }
  }

  const columns: TableProps<Person>['columns'] = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 72,
    },
    {
      title: 'Person',
      dataIndex: 'name',
      render: (name: string, record) => (
        <Space>
          <Avatar src={record.avatar_url ?? undefined}>{name.charAt(0)}</Avatar>
          <Typography.Text strong>{name}</Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Email',
      dataIndex: 'email',
      render: (email: string) => <Tag color="blue">{email}</Tag>,
    },
    {
      title: 'Created at',
      dataIndex: 'created_at',
      width: 200,
      render: (value: string) => new Date(value).toLocaleString('vi-VN'),
    },
    {
      title: '',
      key: 'actions',
      width: 64,
      align: 'right',
      render: (_, record) => (
        <Popconfirm
          title={`Xoá ${record.name}?`}
          okText="Xoá"
          cancelText="Huỷ"
          onConfirm={() => handleDelete(record.id)}
        >
          <Button type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ]

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Persons
        </Typography.Title>
        <Space>
          <Input.Search
            allowClear
            placeholder="Tìm theo tên hoặc email"
            style={{ width: 280 }}
            onSearch={(value) => {
              setSearch(value)
              setPage(1)
            }}
          />
          <Button
            icon={<ReloadOutlined />}
            loading={isFetching}
            onClick={() => refetch()}
          >
            Tải lại
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsModalOpen(true)}
          >
            Thêm
          </Button>
        </Space>
      </Flex>

      <Card>
        <Table<Person>
          rowKey="id"
          columns={columns}
          dataSource={data?.items ?? []}
          loading={isPending}
          locale={{
            emptyText: isError
              ? (error?.message ?? 'Không tải được dữ liệu')
              : 'Không có dữ liệu',
          }}
          pagination={{
            current: data?.page ?? page,
            pageSize: data?.page_size ?? pageSize,
            total: data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (total) => `${total} person`,
            onChange: (nextPage, nextSize) => {
              setPage(nextPage)
              setPageSize(nextSize)
            },
          }}
          scroll={{ x: 'max-content' }}
        />
      </Card>

      <Modal
        title="Thêm person"
        open={isModalOpen}
        onOk={handleCreate}
        okText="Lưu"
        cancelText="Huỷ"
        confirmLoading={createPerson.isPending}
        destroyOnHidden
        onCancel={() => {
          setIsModalOpen(false)
          form.resetFields()
        }}
      >
        <Form form={form} layout="vertical" requiredMark="optional">
          <Form.Item
            name="name"
            label="Tên"
            rules={[{ required: true, message: 'Nhập tên' }]}
          >
            <Input placeholder="Nguyen Van A" />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Nhập email' },
              { type: 'email', message: 'Email không hợp lệ' },
            ]}
          >
            <Input placeholder="user@example.com" />
          </Form.Item>
          <Form.Item name="avatar_url" label="Avatar URL">
            <Input placeholder="https://..." />
          </Form.Item>
        </Form>
      </Modal>
    </Flex>
  )
}
