import { Database, LayoutTemplate, Milestone, ServerCog } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  architectureChoices,
  domainStreams,
  launchMilestones,
  schemaHighlights,
} from "@/lib/mock-data"

export function PlanTabs() {
  return (
    <Tabs defaultValue="stack" className="gap-6">
      <TabsList variant="line" className="w-full justify-start gap-2 overflow-x-auto">
        <TabsTrigger value="stack">Stack</TabsTrigger>
        <TabsTrigger value="domains">Domains</TabsTrigger>
        <TabsTrigger value="schema">Schema</TabsTrigger>
        <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
      </TabsList>

      <TabsContent value="stack" className="grid gap-4 lg:grid-cols-2">
        {architectureChoices.map((choice) => (
          <Card key={choice.title} className="bg-white">
            <CardHeader>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LayoutTemplate className="size-4" />
                <span>{choice.title}</span>
              </div>
              <CardTitle>{choice.value}</CardTitle>
              <CardDescription>{choice.detail}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </TabsContent>

      <TabsContent value="domains" className="grid gap-4 lg:grid-cols-3">
        {domainStreams.map((stream) => (
          <Card key={stream.name} className="bg-white">
            <CardHeader>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ServerCog className="size-4" />
                <span>{stream.name}</span>
              </div>
              <CardTitle>{stream.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm text-foreground/85">
                {stream.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 size-1.5 rounded-full bg-[#e01616]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </TabsContent>

      <TabsContent value="schema" className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="bg-white">
          <CardHeader>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Database className="size-4" />
              <span>Initial tables</span>
            </div>
            <CardTitle>Relational core for launch</CardTitle>
            <CardDescription>
              Keep the event stream append-only and the operational tables boring.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {schemaHighlights.map((table) => (
                <Badge
                  key={table}
                  variant="outline"
                  className="bg-[#9BE564]/18 text-foreground"
                >
                  {table}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-950 text-white ring-neutral-950">
          <CardHeader>
            <CardTitle className="text-white">Operational rule</CardTitle>
            <CardDescription className="text-white/72">
              Do not split ranking, payouts, and content metadata into separate
              services on day one.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-white/82">
            <p>
              A modular monolith is enough until traffic, moderation throughput,
              or model-training cadence actually forces separation.
            </p>
            <p>You need good event logs before you need distributed systems.</p>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="roadmap" className="grid gap-4 lg:grid-cols-4">
        {launchMilestones.map((milestone) => (
          <Card key={milestone.title} className="bg-white">
            <CardHeader>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Milestone className="size-4" />
                <span>{milestone.title}</span>
              </div>
              <CardTitle>{milestone.goal}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </TabsContent>
    </Tabs>
  )
}
