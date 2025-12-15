import { useState } from 'preact/hooks'

interface VideoPlayerProps {
  videoId: string
  title?: string
}

export default function VideoPlayer({ videoId, title = 'Video' }: VideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)

  if (isPlaying) {
    return (
      <div class="relative w-full overflow-hidden rounded-lg" style={{ paddingBottom: '56.25%' }}>
        <iframe
          class="absolute inset-0 w-full h-full"
          src={`https://player.vimeo.com/video/${videoId}?autoplay=1&title=0&byline=0&portrait=0&badge=0&autopause=0`}
          title={title}
          frameBorder="0"
          allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
          allowFullScreen
        />
      </div>
    )
  }

  return (
    <div
      class="relative w-full overflow-hidden rounded-lg group"
      style={{ paddingBottom: '56.25%' }}
    >
      <button
        type="button"
        onClick={() => setIsPlaying(true)}
        class="absolute inset-0 w-full h-full cursor-pointer bg-transparent border-0 p-0"
        aria-label={`Play ${title}`}
      >
        <img
          src="/images/thumbnail.webp"
          alt={title}
          class="w-full h-full object-cover"
          loading="eager"
        />
        {/* Subtle play indicator */}
        <div class="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
          <div class="w-16 h-16 rounded-lg bg-accent group-hover:bg-accent/90 group-hover:scale-110 transition-all flex items-center justify-center shadow-lg">
            <svg class="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </button>
    </div>
  )
}
