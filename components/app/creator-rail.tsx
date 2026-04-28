import { ArrowRight, Coins, Sparkles } from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { SuggestedAccount } from "@/lib/story-store"

type CreatorRailProps = {
  creators: SuggestedAccount[]
}

export function CreatorRail({ creators }: CreatorRailProps) {
  return (
    <div className="space-y-4">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-foreground">
              What the feed is learning
            </h2>
            <p className="text-sm text-muted-foreground">
              Discovery is account-first, not count-first.
            </p>
          </div>
          <Badge variant="outline" className="bg-white">
            {creators.length} ranked account{creators.length === 1 ? "" : "s"}
          </Badge>
        </div>

        {creators.length === 0 ? (
          <Card className="bg-white">
            <CardHeader>
              <Badge
                variant="secondary"
                className="w-fit border-none bg-[#9BE564]/35 text-neutral-950"
              >
                Discovery queue
              </Badge>
              <CardTitle>No recommendations yet</CardTitle>
              <CardDescription>
                Once a few live stories exist, this rail will rank accounts from
                the same Neon feed graph the main viewport uses.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <div className="space-y-3">
          {creators.map((creator) => (
            <Card key={creator.id} className="bg-white">
              <CardHeader className="gap-3">
                <div className="flex items-start gap-3">
                  <Avatar size="lg">
                    <AvatarImage src={creator.imageUrl ?? undefined} alt={creator.name} />
                    <AvatarFallback>
                      {creator.name
                        .split(" ")
                        .map((part) => part[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{creator.name}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {creator.handle}
                        </p>
                      </div>
                      <Badge
                        variant="secondary"
                        className="border-none bg-[#e01616]/18 text-[#A43B12]"
                      >
                        {creator.storyStreak}
                      </Badge>
                    </div>
                    <p className="text-sm text-foreground/85">{creator.reason}</p>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-3">
                <Separator />
                <div className="flex items-start justify-between gap-3 text-sm">
                  <div className="inline-flex items-center gap-2 text-muted-foreground">
                    <Coins className="mt-0.5 size-4" />
                    <span>{creator.monetization}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="px-0">
                    Open account
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <Card className="bg-neutral-950 text-white ring-neutral-950">
        <CardHeader>
          <Badge className="w-fit border-none bg-[#e01616] text-neutral-950">
            Monetization fabric
          </Badge>
          <CardTitle className="text-white">
            Brand payout and ad-share run through one ledger
          </CardTitle>
          <CardDescription className="text-white/72">
            Organic mentions, explicit tags, and baseline ad-share can all resolve
            into the same earnings system.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-white/80">
          <div className="inline-flex items-center gap-2">
            <Sparkles className="size-4 text-[#9BE564]" />
            <span>Explicit tags and caption mentions both become payout signals.</span>
          </div>
          <div className="inline-flex items-center gap-2">
            <Sparkles className="size-4 text-[#9BE564]" />
            <span>Daily ad-share still settles through the same ledger model.</span>
          </div>
          <div className="inline-flex items-center gap-2">
            <Sparkles className="size-4 text-[#9BE564]" />
            <span>Stripe Connect payouts once balances clear review.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
