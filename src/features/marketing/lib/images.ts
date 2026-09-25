/**
 * Card photography for the landing page.
 *
 * Photos are hot-linked from Unsplash (free to use, no attribution required)
 * and optimized by `next/image`, so `images.unsplash.com` is allowed in
 * next.config.ts. Swap any value below for your own photo — a local file such
 * as "/images/voice-qa.jpg" works just as well.
 */
const unsplash = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=80`;

/** Feature bento grid. */
export const featurePhotos: Record<string, string> = {
  "Voice-Based Q&A": unsplash("photo-1517245386807-bb43f82c33c4"),
  "Document Q&A": unsplash("photo-1499750310107-5fef28a66643"),
  "Quiz Generation": unsplash("photo-1434030216411-0b793f4b4173"),
  "Filipino & Cebuano Detection": unsplash("photo-1526778548025-fa2f459cd5c1"),
};

/** How-it-works step pills, in step order. */
export const stepPhotos = [
  unsplash("photo-1516321318423-f06f85e504b3"),
  unsplash("photo-1454165804606-c3d57bc86b40"),
  unsplash("photo-1503676260728-1c00da094a0b"),
  unsplash("photo-1552664730-d307ca884978"),
];

/** Parallax explore cards, in display order. */
export const explorePhotos = {
  English: unsplash("photo-1501504905252-473c47e087f8"),
  Filipino: unsplash("photo-1523240795612-9a054b0db644"),
  Cebuano: unsplash("photo-1522202176988-66273c2fd55f"),
  "Smart Flashcards": unsplash("photo-1532012197267-da84d127e765"),
  "Collaborative Study Rooms": unsplash("photo-1519389950473-47ba0277781c"),
  "Progress Visualization": unsplash("photo-1543269865-cbf427effbad"),
} as const;
