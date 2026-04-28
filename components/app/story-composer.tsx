import { Camera, Clapperboard, Coins } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

type StoryComposerProps = {
  handle: string
}

export function StoryComposer({ handle }: StoryComposerProps) {
  return (
    <Card id="composer" className="bg-white">
      <CardHeader className="space-y-3">
        <Badge
          variant="secondary"
          className="w-fit border-none bg-[#9BE564]/35 text-neutral-950"
        >
          Story composer
        </Badge>
        <div className="space-y-1">
          <CardTitle>Post a story from @{handle}</CardTitle>
          <CardDescription>
            Stories go live for 24 hours. Brand tags and caption mentions become
            payout signals the moment the post lands.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <form
          action="/api/stories"
          method="post"
          encType="multipart/form-data"
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label htmlFor="media" className="text-sm font-medium text-foreground">
              Story asset
            </label>
            <Input
              id="media"
              name="media"
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              required
            />
            <p className="text-xs text-muted-foreground">
              JPG, PNG, WEBP, MP4, or WEBM. Uploads are capped at 25 MB for now.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="caption" className="text-sm font-medium text-foreground">
              Caption
            </label>
            <Textarea
              id="caption"
              name="caption"
              className="min-h-28 resize-none"
              placeholder="Drop the context, scene, or brand mention here."
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="brandTags"
              className="text-sm font-medium text-foreground"
            >
              Brand tags
            </label>
            <Input
              id="brandTags"
              name="brandTags"
              placeholder="nike, matcha-house, local-run-club"
            />
          </div>

          <div className="grid gap-2 text-sm text-muted-foreground">
            <div className="inline-flex items-center gap-2">
              <Camera className="size-4" />
              <span>Posting is available from the same account people use to follow and reply.</span>
            </div>
            <div className="inline-flex items-center gap-2">
              <Clapperboard className="size-4" />
              <span>Video and image stories share the same feed surface.</span>
            </div>
            <div className="inline-flex items-center gap-2">
              <Coins className="size-4" />
              <span>Explicit tags and caption mentions both write monetization signals.</span>
            </div>
          </div>

          <Button type="submit" className="w-full">
            Post story
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
