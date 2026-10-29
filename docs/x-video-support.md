# Adding X (Twitter) videos

The import tool now accepts YouTube **and** X (Twitter) links in the same JSON
file. The platform is detected from `videoUrl`, so existing YouTube files keep
working unchanged.

## 1. Apply the database migration

Run `supabase/migrations/20261029120000_add_x_video_support.sql` once in the
Supabase SQL editor (or apply it with the Supabase CLI).

It:

- adds `catalogue_videos.platform` (`youtube` or `x`, default `youtube`)
- adds `catalogue_videos.x_post_id` with a unique index
- adds `video_import_batches.platforms`
- replaces `import_video_batch` so it stores the platform and deduplicates X
  posts by status ID

Existing rows are marked `youtube`. The old `youtube_id` column is kept.

## 2. JSON format

YouTube records stay exactly as before:

```json
{
  "category": "Music",
  "channelName": "DavidoVEVO",
  "videoUrl": "https://www.youtube.com/watch?v=3Iyuym-Gci0",
  "videoTitle": "Davido - Fall (Official Video)",
  "actualChannelName": "DavidoVEVO",
  "isUnrelatedChannel": false
}
```

X records use the post URL:

```json
{
  "category": "Music",
  "channelName": "@davido",
  "videoUrl": "https://x.com/davido/status/1234567890123456789",
  "videoTitle": "Davido - Fall (clip)",
  "actualChannelName": "davido",
  "isUnrelatedChannel": false
}
```

You can mix both platforms in one file. `platform` is optional; when present it
must match the URL (`"youtube"` or `"x"`), otherwise the record is rejected as a
conflict.

Accepted X URL shapes:

- `https://x.com/user/status/1234567890123456789`
- `https://twitter.com/user/status/1234567890123456789`
- `https://x.com/user/status/1234567890123456789/video/1?s=20`

`t.co` short links are rejected because they cannot be resolved without a
network call. Paste the full `x.com/.../status/...` URL instead.

## 3. Convert a saved HTML page to JSON

You do not have to build the JSON by hand. Save the page from X (or a YouTube
results page) with **Ctrl+S → Webpage, HTML only**, scroll until the videos are
loaded first, then use **Upload HTML** on the home page.

The browser converts the page to the JSON records above and adds them to the
video library. Click **Export JSON** to download the file, then push that JSON
with **JSON Video Import Form**. Only JSON is ever sent to Supabase.

The `/import` page can also convert an HTML file directly, but it still sends
JSON to the server. Either route goes through the same validation.

- Category and channel come from the filename, e.g.
  `Music , (@davido) _ X.html` → category `Music`, channel `@davido`.
- X posts are matched by their `x.com/.../status/...` links. Posts containing a
  video player are imported; text-only posts are skipped with a warning.
- If no video player can be detected in any post, every X post found in the page
  is included and a warning asks you to remove text-only posts.
- Titles come from the post text, then the post date, then the status ID.
- HTML files are limited to 10 MB. If the page is larger, save a smaller view or
  split it.

## 4. What gets stored

| Column | YouTube | X |
| --- | --- | --- |
| `platform` | `youtube` | `x` |
| `youtube_id` | video ID | `null` |
| `x_post_id` | `null` | status ID |
| `video_url` | original URL | original URL |

Deduplication is by `video_url`, `youtube_id` (YouTube) and `x_post_id` (X).
Re-importing the same file inserts nothing and reports every record as already
in the catalogue.

## 5. Displaying X posts in the main app

YouTube videos can keep using the existing embed:

```tsx
<iframe
  src={`https://www.youtube-nocookie.com/embed/${video.youtube_id}`}
  title={video.video_title}
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowFullScreen
/>
```

X posts need X's embed. The simplest option in React is the official embed
iframe, which does not require loading `widgets.js`:

```tsx
<iframe
  src={`https://platform.twitter.com/embed/Tweet.html?id=${video.x_post_id}`}
  title={video.video_title}
  allowFullScreen
/>
```

Choose the embed by platform:

```tsx
{video.platform === "x" && video.x_post_id ? (
  <iframe
    src={`https://platform.twitter.com/embed/Tweet.html?id=${video.x_post_id}`}
    title={video.video_title}
    allowFullScreen
  />
) : video.youtube_id ? (
  <iframe
    src={`https://www.youtube-nocookie.com/embed/${video.youtube_id}`}
    title={video.video_title}
    allowFullScreen
  />
) : null}
```

Notes:

- The X embed only works for public posts. Protected or deleted posts will show
  X's fallback instead of the video.
- X controls the embed markup and may change it. If the iframe stops working,
  switch to the official `blockquote` + `https://platform.twitter.com/widgets.js`
  widget.
- Do not try to download and re-host X videos. Embedding is the supported path.
