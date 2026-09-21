/**
 * COCO class names in the order EfficientDet-Lite actually emits.
 *
 * There are two COCO orderings in circulation and they are not compatible:
 *
 *  - the 91-entry "paper" ordering, which keeps gaps for classes that were
 *    defined but never annotated (streetsign, hat, shoe, plate, mirror, …)
 *  - this 80-entry contiguous ordering, which drops the gaps
 *
 * TF Hub's EfficientDet-Lite outputs the 80-class indices. Using the 91-entry
 * list against it shifts almost every label: index 63 reads as "couch" when
 * the model means "laptop", and a phone comes back named "laptop". Nothing
 * errors — the labels are simply wrong, which is far harder to spot than a
 * crash.
 *
 * Do not add a placeholder at index 0. The model is 0-based over this list:
 * class 0 is genuinely "person".
 */
export const COCO_LABELS: readonly string[] = [
  'person',
  'bicycle',
  'car',
  'motorcycle',
  'airplane',
  'bus',
  'train',
  'truck',
  'boat',
  'traffic light',
  'fire hydrant',
  'stop sign',
  'parking meter',
  'bench',
  'bird',
  'cat',
  'dog',
  'horse',
  'sheep',
  'cow',
  'elephant',
  'bear',
  'zebra',
  'giraffe',
  'backpack',
  'umbrella',
  'handbag',
  'tie',
  'suitcase',
  'frisbee',
  'skis',
  'snowboard',
  'sports ball',
  'kite',
  'baseball bat',
  'baseball glove',
  'skateboard',
  'surfboard',
  'tennis racket',
  'bottle',
  'wine glass',
  'cup',
  'fork',
  'knife',
  'spoon',
  'bowl',
  'banana',
  'apple',
  'sandwich',
  'orange',
  'broccoli',
  'carrot',
  'hot dog',
  'pizza',
  'donut',
  'cake',
  'chair',
  'couch',
  'potted plant',
  'bed',
  'dining table',
  'toilet',
  'tv',
  'laptop',
  'mouse',
  'remote',
  'keyboard',
  'cell phone',
  'microwave',
  'oven',
  'toaster',
  'sink',
  'refrigerator',
  'book',
  'clock',
  'vase',
  'scissors',
  'teddy bear',
  'hair drier',
  'toothbrush',
];

export function labelForIndex(index: number): string {
  return COCO_LABELS[Math.round(index)] ?? 'unknown';
}
