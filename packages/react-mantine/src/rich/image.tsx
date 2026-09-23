'use client';
import { Modal } from '@mantine/core';
import {
  createMarkdownImage as createReactImage,
  type MarkdownImageOptions,
  type ImagePreviewDialogProps,
} from '@ai-markdown/react/components/image';
function MantineImageDialog({ open, label, onClose, children }: ImagePreviewDialogProps) {
  return (
    <Modal opened={open} onClose={onClose} title={label} withCloseButton={false} size="auto">
      {children}
    </Modal>
  );
}
export type {
  MarkdownImageOptions,
  MarkdownImageIcon,
  ImageIconProps,
  ImageIconName,
} from '@ai-markdown/react/components/image';
export function createMarkdownImage(options: MarkdownImageOptions = {}) {
  return createReactImage({ ...options, Dialog: options.Dialog ?? MantineImageDialog });
}
export const MarkdownImage = createMarkdownImage();
