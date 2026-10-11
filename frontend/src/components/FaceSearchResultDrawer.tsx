import { Alert, Drawer, Empty, Flex, Skeleton, Tag, Typography } from "antd";

import FaceBoundingBoxOverlay from "@/components/FaceBoundingBoxOverlay";
import { useSearchByFace } from "@/hooks/useFaces";
import type { ImageRecord } from "@/types/face";

const CROP_SIZE = 72;

interface FaceSearchResultDrawerProps {
  /** Ảnh chứa khuôn mặt query - dùng để crop khuôn mặt hiển thị ở header. */
  sourceImage: ImageRecord;
  faceId: string | null;
  onClose: () => void;
}

function FaceCrop({
  image,
  bbox,
}: {
  image: ImageRecord;
  bbox: [number, number, number, number];
}) {
  const [x1, y1, x2, y2] = bbox;
  const scale = CROP_SIZE / (x2 - x1);
  return (
    <div
      style={{
        width: CROP_SIZE,
        height: (y2 - y1) * scale,
        borderRadius: 6,
        border: "2px solid #f5222d",
        backgroundImage: `url(${image.image_url})`,
        backgroundSize: `${image.image_width * scale}px auto`,
        backgroundPosition: `-${x1 * scale}px -${y1 * scale}px`,
        backgroundRepeat: "no-repeat",
        flexShrink: 0,
      }}
    />
  );
}

export default function FaceSearchResultDrawer({
  sourceImage,
  faceId,
  onClose,
}: FaceSearchResultDrawerProps) {
  const { data, isLoading, error } = useSearchByFace(faceId);
  const queryFace = sourceImage.faces.find((f) => f.face_id === faceId);

  return (
    <Drawer
      title="Ảnh chứa khuôn mặt này"
      width={560}
      open={!!faceId}
      onClose={onClose}
      destroyOnHidden
    >
      <Flex vertical gap={16}>
        {queryFace && (
          <Flex gap={12} align="center">
            <FaceCrop image={sourceImage} bbox={queryFace.bbox} />
            <Typography.Text type="secondary">
              {isLoading
                ? "Đang tìm kiếm..."
                : data
                  ? `Tìm thấy ${data.total} ảnh khác chứa khuôn mặt tương tự`
                  : null}
            </Typography.Text>
          </Flex>
        )}

        {isLoading && <Skeleton active paragraph={{ rows: 6 }} />}

        {error && (
          <Alert
            type="error"
            showIcon
            message={
              error instanceof Error ? error.message : "Tìm kiếm thất bại"
            }
          />
        )}

        {data && data.items.length === 0 && (
          <Empty description="Không tìm thấy ảnh nào khác chứa khuôn mặt này" />
        )}

        {data?.items.map((item) => (
          <Flex vertical gap={8} key={item.image.id}>
            <Flex justify="space-between" align="center">
              <Tag color="red">Giống {(item.score * 100).toFixed(1)}%</Tag>
              <Typography.Link
                href={item.image.image_url}
                target="_blank"
                ellipsis
                style={{ maxWidth: 380 }}
              >
                {item.image.image_url}
              </Typography.Link>
            </Flex>
            <FaceBoundingBoxOverlay
              imageUrl={item.image.image_url}
              imageWidth={item.image.image_width}
              imageHeight={item.image.image_height}
              faces={item.image.faces.map((f) => ({
                id: f.face_id,
                bbox: f.bbox,
                det_score: f.det_score,
              }))}
              highlightedFaceIds={[item.matched_face_id]}
              maxWidth={520}
            />
          </Flex>
        ))}
      </Flex>
    </Drawer>
  );
}
