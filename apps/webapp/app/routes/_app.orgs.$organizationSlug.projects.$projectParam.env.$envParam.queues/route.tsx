import {
  ArrowUpCircleIcon,
  BookOpenIcon,
  ChatBubbleLeftEllipsisIcon,
  PauseIcon,
  PlayIcon,
  RectangleStackIcon,
} from "@heroicons/react/20/solid";
import { Await, Form, useNavigation, type MetaFunction } from "@remix-run/react";
import { type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { Suspense, useEffect, useState } from "react";
import { TypedAwait, typeddefer, useTypedLoaderData } from "remix-typedjson";
import { z } from "zod";
import { TaskIcon } from "~/assets/icons/TaskIcon";
import { AdminDebugTooltip } from "~/components/admin/debugTooltip";
import { Feedback } from "~/components/Feedback";
import { PageBody, PageContainer } from "~/components/layout/AppLayout";
import { BigNumber } from "~/components/metrics/BigNumber";
import { Button, LinkButton } from "~/components/primitives/Buttons";
import { NavBar, PageAccessories, PageTitle } from "~/components/primitives/PageHeader";
import { PaginationControls } from "~/components/primitives/Pagination";
import { Spinner } from "~/components/primitives/Spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableCellMenu,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "~/components/primitives/Table";
import { useEnvironment } from "~/hooks/useEnvironment";
import { useOrganization } from "~/hooks/useOrganizations";
import { findProjectBySlug } from "~/models/project.server";
import { findEnvironmentBySlug } from "~/models/runtimeEnvironment.server";
import { QueueListPresenter } from "~/presenters/v3/QueueListPresenter.server";
import { requireUserId } from "~/services/session.server";
import { cn } from "~/utils/cn";
import { docsPath, EnvironmentParamSchema, v3BillingPath } from "~/utils/pathBuilder";
import { PauseEnvironmentService } from "~/v3/services/pauseEnvironment.server";
import { useCurrentPlan } from "../_app.orgs.$organizationSlug/route";
import { redirectWithErrorMessage, redirectWithSuccessMessage } from "~/models/message.server";
import { EnvironmentQueuePresenter } from "~/presenters/v3/EnvironmentQueuePresenter.server";
import { Dialog, DialogContent, DialogHeader, DialogTrigger } from "~/components/primitives/Dialog";
import { FormButtons } from "~/components/primitives/FormButtons";
import { DialogClose } from "@radix-ui/react-dialog";
import { Paragraph } from "~/components/primitives/Paragraph";
import {
  SimpleTooltip,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/primitives/Tooltip";
import { type RuntimeEnvironmentType } from "@trigger.dev/database";
import { environmentFullTitle } from "~/components/environments/EnvironmentLabel";
import { Callout } from "~/components/primitives/Callout";
import upgradeForQueuesPath from "~/assets/images/queues-dashboard.png";
import { PauseQueueService } from "~/v3/services/pauseQueue.server";
import { Badge } from "~/components/primitives/Badge";

const SearchParamsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
});

export const meta: MetaFunction = () => {
  return [
    {
      title: `Queues | Trigger.dev`,
    },
  ];
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const userId = await requireUserId(request);
  const { organizationSlug, projectParam, envParam } = EnvironmentParamSchema.parse(params);

  const url = new URL(request.url);
  const { page } = SearchParamsSchema.parse(Object.fromEntries(url.searchParams));

  const project = await findProjectBySlug(organizationSlug, projectParam, userId);
  if (!project) {
    throw new Response(undefined, {
      status: 404,
      statusText: "Project not found",
    });
  }

  const environment = await findEnvironmentBySlug(project.id, envParam, userId);
  if (!environment) {
    throw new Response(undefined, {
      status: 404,
      statusText: "Environment not found",
    });
  }

  try {
    const queueListPresenter = new QueueListPresenter();
    const queues = await queueListPresenter.call({
      environment,
      page,
    });

    const environmentQueuePresenter = new EnvironmentQueuePresenter();

    return typeddefer({
      ...queues,
      environment: environmentQueuePresenter.call(environment),
    });
  } catch (error) {
    console.error(error);
    throw new Response(undefined, {
      status: 400,
      statusText: "Something went wrong, if this problem persists please contact support.",
    });
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const userId = await requireUserId(request);
  if (request.method.toLowerCase() !== "post") {
    return redirectWithErrorMessage(
      `/orgs/${params.organizationSlug}/projects/${params.projectParam}/env/${params.envParam}/queues`,
      request,
      "Wrong method"
    );
  }

  const { organizationSlug, projectParam, envParam } = EnvironmentParamSchema.parse(params);

  const project = await findProjectBySlug(organizationSlug, projectParam, userId);
  if (!project) {
    throw new Response(undefined, {
      status: 404,
      statusText: "Project not found",
    });
  }

  const environment = await findEnvironmentBySlug(project.id, envParam, userId);
  if (!environment) {
    throw new Response(undefined, {
      status: 404,
      statusText: "Environment not found",
    });
  }

  const formData = await request.formData();
  const action = formData.get("action");

  switch (action) {
    case "environment-pause":
      const pauseService = new PauseEnvironmentService();
      await pauseService.call(environment, "paused");
      return redirectWithSuccessMessage(
        `/orgs/${organizationSlug}/projects/${projectParam}/env/${envParam}/queues`,
        request,
        "Environment paused"
      );
    case "environment-resume":
      const resumeService = new PauseEnvironmentService();
      await resumeService.call(environment, "resumed");
      return redirectWithSuccessMessage(
        `/orgs/${organizationSlug}/projects/${projectParam}/env/${envParam}/queues`,
        request,
        "Environment resumed"
      );
    case "queue-pause":
    case "queue-resume": {
      const friendlyId = formData.get("friendlyId");
      if (!friendlyId) {
        return redirectWithErrorMessage(
          `/orgs/${organizationSlug}/projects/${projectParam}/env/${envParam}/queues`,
          request,
          "Queue ID is required"
        );
      }

      const queueService = new PauseQueueService();
      const result = await queueService.call(
        environment,
        friendlyId.toString(),
        action === "queue-pause" ? "paused" : "resumed"
      );

      if (!result.success) {
        return redirectWithErrorMessage(
          `/orgs/${organizationSlug}/projects/${projectParam}/env/${envParam}/queues`,
          request,
          result.error ?? `Failed to ${action === "queue-pause" ? "pause" : "resume"} queue`
        );
      }

      return redirectWithSuccessMessage(
        `/orgs/${organizationSlug}/projects/${projectParam}/env/${envParam}/queues`,
        request,
        `Queue ${action === "queue-pause" ? "paused" : "resumed"}`
      );
    }
    default:
      return redirectWithErrorMessage(
        `/orgs/${organizationSlug}/projects/${projectParam}/env/${envParam}/queues`,
        request,
        "Something went wrong"
      );
  }
};

export default function Page() {
  const { environment, queues, success, pagination, code } = useTypedLoaderData<typeof loader>();

  const organization = useOrganization();
  const env = useEnvironment();
  const plan = useCurrentPlan();

  return (
    <PageContainer>
      <NavBar>
        <PageTitle title="Queues" />
        <PageAccessories>
          <AdminDebugTooltip />
          <LinkButton
            variant={"docs/small"}
            LeadingIcon={BookOpenIcon}
            to={docsPath("/queue-concurrency")}
          >
            Queues docs
          </LinkButton>
        </PageAccessories>
      </NavBar>
      <PageBody scrollable={false}>
        <div className="flex flex-col">
          <div className="grid grid-cols-3 gap-3 p-3">
            <Suspense fallback={<BigNumber title="Queued" loading={true} />}>
              <TypedAwait resolve={environment}>
                {(environment) => (
                  <BigNumber
                    title="Queued"
                    value={environment.queued}
                    suffix={env.paused && environment.queued > 0 ? "paused" : undefined}
                    animate
                    accessory={<EnvironmentPauseResumeButton env={env} />}
                    valueClassName={env.paused ? "text-amber-500" : undefined}
                  />
                )}
              </TypedAwait>
            </Suspense>
            <Suspense fallback={<BigNumber title="Running" loading={true} />}>
              <TypedAwait resolve={environment}>
                {(environment) => <BigNumber title="Running" value={environment.running} animate />}
              </TypedAwait>
            </Suspense>
            <Suspense fallback={<BigNumber title="Concurrency limit" loading={true} />}>
              <TypedAwait resolve={environment}>
                {(environment) => (
                  <BigNumber
                    title="Concurrency limit"
                    value={environment.concurrencyLimit}
                    animate
                    accessory={
                      plan ? (
                        plan?.v3Subscription?.plan?.limits.concurrentRuns.canExceed ? (
                          <Feedback
                            button={
                              <Button
                                variant="tertiary/small"
                                LeadingIcon={ChatBubbleLeftEllipsisIcon}
                                leadingIconClassName="text-indigo-500"
                              >
                                Increase limit
                              </Button>
                            }
                            defaultValue="help"
                          />
                        ) : (
                          <LinkButton
                            to={v3BillingPath(
                              organization,
                              "Upgrade your plan for more concurrency"
                            )}
                            variant="secondary/small"
                            LeadingIcon={ArrowUpCircleIcon}
                            leadingIconClassName="text-indigo-500"
                          >
                            Increase limit
                          </LinkButton>
                        )
                      ) : null
                    }
                  />
                )}
              </TypedAwait>
            </Suspense>
          </div>

          {success ? (
            <>
              <Table containerClassName="border-t">
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Name</TableHeaderCell>
                    <TableHeaderCell alignment="right">Queued</TableHeaderCell>
                    <TableHeaderCell alignment="right">Running</TableHeaderCell>
                    <TableHeaderCell alignment="right">Concurrency limit</TableHeaderCell>
                    <TableHeaderCell className="w-[1%] pl-24">
                      <span className="sr-only">Pause/resume</span>
                    </TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <Suspense
                    fallback={
                      <TableRow>
                        <TableCell colSpan={5}>
                          <div className="grid place-items-center py-6">
                            <Spinner />
                          </div>
                        </TableCell>
                      </TableRow>
                    }
                  >
                    <TypedAwait
                      resolve={Promise.all([queues, environment])}
                      errorElement={<Paragraph variant="small">Error loading queues</Paragraph>}
                    >
                      {([q, env]) => {
                        return q.length > 0 ? (
                          q.map((queue) => (
                            <TableRow key={queue.name}>
                              <TableCell>
                                <span className="flex items-center gap-2">
                                  {queue.type === "task" ? (
                                    <SimpleTooltip
                                      button={
                                        <TaskIcon
                                          className={cn(
                                            "size-4 text-blue-500",
                                            queue.paused && "opacity-50"
                                          )}
                                        />
                                      }
                                      content={`This queue was automatically created from your "${queue.name}" task`}
                                    />
                                  ) : (
                                    <SimpleTooltip
                                      button={
                                        <RectangleStackIcon
                                          className={cn(
                                            "size-4 text-purple-500",
                                            queue.paused && "opacity-50"
                                          )}
                                        />
                                      }
                                      content={`This is a custom queue you added in your code.`}
                                    />
                                  )}
                                  <span className={queue.paused ? "opacity-50" : undefined}>
                                    {queue.name}
                                  </span>
                                  {queue.paused ? (
                                    <Badge variant="extra-small" className="text-warning">
                                      Paused
                                    </Badge>
                                  ) : null}
                                </span>
                              </TableCell>
                              <TableCell
                                alignment="right"
                                className={queue.paused ? "opacity-50" : undefined}
                              >
                                {queue.queued}
                              </TableCell>
                              <TableCell
                                alignment="right"
                                className={queue.paused ? "opacity-50" : undefined}
                              >
                                {queue.running}
                              </TableCell>
                              <TableCell
                                alignment="right"
                                className={queue.paused ? "opacity-50" : undefined}
                              >
                                {queue.concurrencyLimit ?? (
                                  <span className="text-text-dimmed">
                                    Max ({env.concurrencyLimit})
                                  </span>
                                )}
                              </TableCell>
                              <TableCellMenu
                                isSticky
                                visibleButtons={
                                  queue.paused && <QueuePauseResumeButton queue={queue} />
                                }
                                hiddenButtons={
                                  !queue.paused && <QueuePauseResumeButton queue={queue} />
                                }
                              />
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={5}>
                              <div className="grid place-items-center py-6 text-text-dimmed">
                                No queues found
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      }}
                    </TypedAwait>
                  </Suspense>
                </TableBody>
              </Table>

              <div
                className={cn(
                  "grid h-fit max-h-full min-h-full overflow-x-auto",
                  pagination.totalPages > 1 ? "grid-rows-[1fr_auto]" : "grid-rows-[1fr]"
                )}
              >
                <div
                  className={cn(
                    "flex min-h-full",
                    pagination.totalPages > 1 && "justify-end border-t border-grid-dimmed px-2 py-3"
                  )}
                >
                  <PaginationControls
                    currentPage={pagination.currentPage}
                    totalPages={pagination.totalPages}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="grid place-items-center py-6 text-text-dimmed">
              {code === "engine-version" ? (
                <EngineVersionUpgradeCallout />
              ) : (
                <Callout variant="error">Something went wrong</Callout>
              )}
            </div>
          )}
        </div>
      </PageBody>
    </PageContainer>
  );
}

function EnvironmentPauseResumeButton({
  env,
}: {
  env: { type: RuntimeEnvironmentType; paused: boolean };
}) {
  const navigation = useNavigation();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (navigation.state === "loading" || navigation.state === "idle") {
      setIsOpen(false);
    }
  }, [navigation.state]);

  const isLoading = Boolean(
    navigation.formData?.get("action") === (env.paused ? "environment-resume" : "environment-pause")
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <div>
        <TooltipProvider disableHoverableContent={true}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    variant="tertiary/small"
                    LeadingIcon={env.paused ? PlayIcon : PauseIcon}
                    leadingIconClassName={env.paused ? "text-success" : "text-amber-500"}
                  >
                    {env.paused ? "Resume..." : "Pause environment..."}
                  </Button>
                </DialogTrigger>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" className={"text-xs"}>
              {env.paused
                ? `Resume processing runs in ${environmentFullTitle(env)}.`
                : `Pause processing runs in ${environmentFullTitle(env)}.`}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <DialogContent>
        <DialogHeader>{env.paused ? "Resume environment?" : "Pause environment?"}</DialogHeader>
        <div className="flex flex-col gap-3 pt-3">
          <Paragraph>
            {env.paused
              ? `This will allow runs to be dequeued in ${environmentFullTitle(env)} again.`
              : `This will pause all runs from being dequeued in ${environmentFullTitle(
                  env
                )}. Any executing runs will continue to run.`}
          </Paragraph>
          <Form method="post" onSubmit={() => setIsOpen(false)}>
            <input
              type="hidden"
              name="action"
              value={env.paused ? "environment-resume" : "environment-pause"}
            />
            <FormButtons
              confirmButton={
                <Button
                  type="submit"
                  disabled={isLoading}
                  variant={env.paused ? "primary/medium" : "danger/medium"}
                  LeadingIcon={isLoading ? <Spinner /> : env.paused ? PlayIcon : PauseIcon}
                  shortcut={{ modifiers: ["mod"], key: "enter" }}
                >
                  {env.paused ? "Resume environment" : "Pause environment"}
                </Button>
              }
              cancelButton={
                <DialogClose asChild>
                  <Button type="button" variant="tertiary/medium">
                    Cancel
                  </Button>
                </DialogClose>
              }
            />
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function QueuePauseResumeButton({
  queue,
}: {
  /** The "id" here is a friendlyId */
  queue: { id: string; name: string; paused: boolean };
}) {
  const navigation = useNavigation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <div>
        <TooltipProvider disableHoverableContent={true}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    variant="tertiary/small"
                    LeadingIcon={queue.paused ? PlayIcon : PauseIcon}
                    leadingIconClassName={queue.paused ? "text-success" : "text-amber-500"}
                  >
                    {queue.paused ? "Resume..." : "Pause..."}
                  </Button>
                </DialogTrigger>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" className={"text-xs"}>
              {queue.paused
                ? `Resume processing runs in queue "${queue.name}"`
                : `Pause processing runs in queue "${queue.name}"`}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <DialogContent>
        <DialogHeader>{queue.paused ? "Resume queue?" : "Pause queue?"}</DialogHeader>
        <div className="flex flex-col gap-3 pt-3">
          <Paragraph>
            {queue.paused
              ? `This will allow runs to be dequeued in the "${queue.name}" queue again.`
              : `This will pause all runs from being dequeued in the "${queue.name}" queue. Any executing runs will continue to run.`}
          </Paragraph>
          <Form method="post" onSubmit={() => setIsOpen(false)}>
            <input
              type="hidden"
              name="action"
              value={queue.paused ? "queue-resume" : "queue-pause"}
            />
            <input type="hidden" name="friendlyId" value={queue.id} />
            <FormButtons
              confirmButton={
                <Button
                  type="submit"
                  shortcut={{ modifiers: ["mod"], key: "enter" }}
                  variant={queue.paused ? "primary/medium" : "danger/medium"}
                  LeadingIcon={queue.paused ? PlayIcon : PauseIcon}
                >
                  {queue.paused ? "Resume queue" : "Pause queue"}
                </Button>
              }
              cancelButton={
                <DialogClose asChild>
                  <Button type="button" variant="tertiary/medium">
                    Cancel
                  </Button>
                </DialogClose>
              }
            />
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EngineVersionUpgradeCallout() {
  return (
    <div className="mt-4 flex max-w-lg flex-col gap-4 rounded-sm border border-grid-bright bg-background-bright px-4">
      <div className="flex items-center justify-between gap-2 border-b border-grid-dimmed py-4">
        <h4 className="text-base text-text-bright">New queues table</h4>
        <LinkButton LeadingIcon={BookOpenIcon} to={docsPath("v4-upgrade")} variant={"docs/small"}>
          Upgrade guide
        </LinkButton>
      </div>
      <div className="space-y-4 pb-4">
        <Paragraph variant="small">
          Upgrade to SDK version 4+ to view the new queues table, and be able to pause and resume
          individual queues.
        </Paragraph>
        <img
          src={upgradeForQueuesPath}
          alt="Upgrade for queues"
          className="rounded-sm border border-grid-dimmed"
        />
      </div>
    </div>
  );
}

export function isEnvironmentPauseResumeFormSubmission(
  formMethod: string | undefined,
  formData: FormData | undefined
) {
  if (!formMethod || !formData) {
    return false;
  }

  return (
    formMethod.toLowerCase() === "post" &&
    (formData.get("action") === "environment-pause" ||
      formData.get("action") === "environment-resume")
  );
}
