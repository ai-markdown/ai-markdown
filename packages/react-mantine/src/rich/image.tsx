'use client';
import { Modal } from '@mantine/core';
import { createMarkdownImage, type ImagePreviewDialogProps } from '@ai-markdown/react/components/image';
function MantineImageDialog({ open, label, onClose, children }: ImagePreviewDialogProps) {
  return (
    <Modal opened={open} onClose={onClose} title={label} withCloseButton={false} size="auto">
      {children}
    </Modal>
  );
}
export const MarkdownImage = createMarkdownImage({ Dialog: MantineImageDialog });
