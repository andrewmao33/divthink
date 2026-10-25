import type { Account } from './api'
import { supabase } from './auth'

// Who is signed in, as the sidebar and Settings show them.
export type Profile = {
  name: string
  email: string | null
  picture: string | null // a URL or data URL; null = show the initial
}

// The name and picture come from Google when signing in with Google; an email
// sign-in has neither, so the name is the part of the address before the @.
// A picture chosen in Settings wins over Google's.
export async function loadProfile(account: Account | null): Promise<Profile> {
  const user = supabase ? (await supabase.auth.getSession()).data.session?.user : null
  if (!user) return { name: 'Local user', email: null, picture: account?.avatar ?? null }
  const meta = user.user_metadata as Record<string, unknown>
  const text = (key: string) => (typeof meta[key] === 'string' && meta[key] ? (meta[key] as string) : null)
  const email = user.email ?? null
  return {
    name: text('full_name') ?? text('name') ?? email?.split('@')[0] ?? 'You',
    email,
    picture: account?.avatar ?? text('avatar_url') ?? text('picture'),
  }
}

const AVATAR_SIZE = 128

// Shrinks a picked image to a 128px square (centre-cropped) and returns it as a
// data URL, a few kilobytes, small enough to store on the account itself.
export async function avatarFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Pick an image file.')
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That image couldn't be read.")
  })
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  canvas
    .getContext('2d')!
    .drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    )
  bitmap.close()
  // WebP where the browser can write it; others fall back to PNG on their own.
  return canvas.toDataURL('image/webp', 0.85)
}
