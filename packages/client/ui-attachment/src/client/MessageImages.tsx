import type { MessageImagesProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ImageGallery } from '../MessageImage.tsx'
import { messageImageLabels } from './labels.ts'

/** Historical message-image slot entry. */
export function MessageImages({ images, loadImage, align, t }: MessageImagesProps): unknown {
  return ImageGallery({ images, load: loadImage, align, labels: messageImageLabels(t) })
}
