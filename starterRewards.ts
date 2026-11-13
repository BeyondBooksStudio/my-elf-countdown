import images from "./starterRewardImages.json";

/** Generic app artwork only. Each new family receives private, editable database copies. */
export const STARTER_REWARDS = [
  { dayNumber: 2, label: "Choose tonight's story", imageData: images.story, imageMime: "image/jpeg" },
  { dayNumber: 5, label: "Pick a family game", imageData: images.game, imageMime: "image/jpeg" },
  { dayNumber: 9, label: "Cosy hot chocolate together", imageData: images.cocoa, imageMime: "image/jpeg" },
  { dayNumber: 12, label: "Choose a festive film", imageData: images.film, imageMime: "image/jpeg" },
] as const;
