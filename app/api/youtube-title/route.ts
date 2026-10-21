import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const videoId = searchParams.get("videoId")

  if (!videoId) {
    return NextResponse.json({ error: "Video ID is required" }, { status: 400 })
  }

  try {
    // Use YouTube oEmbed API to get video metadata (no API key needed)
    const response = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      },
    )

    if (!response.ok) {
      // Return null data instead of throwing, let the caller handle it
      return NextResponse.json(
        {
          title: null,
          author: null,
          error: `HTTP ${response.status}`,
        },
        { status: 200 },
      )
    }

    const data = await response.json()

    return NextResponse.json({
      title: data.title,
      author: data.author_name,
    })
  } catch (error) {
    console.error("Error fetching YouTube title:", error)
    return NextResponse.json(
      {
        title: null,
        author: null,
        error: "Failed to fetch",
      },
      { status: 200 },
    )
  }
}
