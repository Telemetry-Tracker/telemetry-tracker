import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { DocsArticle } from "@/app/components/docs/DocsArticle";

export const metadata: Metadata = {
  title: "NestJS",
  description: "Integrate Telemetry Tracker with NestJS APIs",
  alternates: { canonical: "./" },
};

export default function DocsNestJsPage() {
  return (
    <DocsArticle
      title="NestJS"
      lede={
        <p>
          Use <code>@telemetry-tracker/node</code> in NestJS backends. Call <code>init()</code> in{" "}
          <code>main.ts</code> before <code>NestFactory.create</code> so global{" "}
          <code>uncaughtException</code> and <code>unhandledRejection</code> handlers are installed,
          then register <code>TelemetryInterceptor</code> so exceptions thrown in controllers are
          reported. Optional Nest middleware tracks HTTP requests. For plain Express or Fastify without Nest,
          see the{" "}
          <Link href="/docs/node" className="text-brand hover:underline">
            Node.js guide
          </Link>
          .
        </p>
      }
    >
      <h2>Install</h2>
      <CodeBlock
        code={`pnpm add @telemetry-tracker/node
# or
npm install @telemetry-tracker/node`}
      />

      <h2>Initialize in main.ts</h2>
      <p>
        Call <code>init()</code> as early as possible — before creating the Nest application:
      </p>
      <CodeBlock
        code={`import { NestFactory } from "@nestjs/core";
import { init, TelemetryInterceptor } from "@telemetry-tracker/node";
import { AppModule } from "./app.module";

async function bootstrap() {
  init({
    ingestUrl: process.env.TELEMETRY_INGEST_URL ?? "https://your-api.example.com",
    app: process.env.TELEMETRY_APP ?? "my-nest-api",
    apiKey: process.env.TELEMETRY_API_KEY,
    platform: "node",
    environment: process.env.NODE_ENV,
  });

  const app = await NestFactory.create(AppModule);
  // Report controller/provider exceptions (Nest catches them before Node's global handlers).
  app.useGlobalInterceptors(new TelemetryInterceptor());
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();`}
      />

      <h2>Controller exceptions</h2>
      <p>
        Nest catches exceptions from controllers and the services they call and turns them into
        HTTP responses, so they never reach the process handlers. The global{" "}
        <code>TelemetryInterceptor</code> (node 1.5.0+) reports them with the method, path (no query
        string) and handler name, then rethrows the original error, so Nest&apos;s response and
        your exception filters are unchanged. HTTP exceptions below 500 (for example{" "}
        <code>NotFoundException</code>) are not reported; pass{" "}
        <code>{"{ shouldReport: (err) => boolean }"}</code> to change that. Errors thrown in guards
        or middleware run before interceptors: report those from your own exception filter with{" "}
        <code>captureNestException(exception, host)</code>.
      </p>
      <CodeBlock
        code={`// optional: custom global filter that also reports
import { ArgumentsHost, Catch } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { captureNestException } from "@telemetry-tracker/node";

@Catch()
export class ReportingFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    captureNestException(exception, host);
    super.catch(exception, host);
  }
}
// main.ts: const { httpAdapter } = app.get(HttpAdapterHost);
//          app.useGlobalFilters(new ReportingFilter(httpAdapter));
// Use either the filter or the interceptor for controller errors, not both.`}
      />

      <h2>Request middleware</h2>
      <p>
        Wrap the generic <code>middleware()</code> from <code>@telemetry-tracker/node</code> in a
        Nest middleware class to emit <code>$request</code> events (method, url, duration). The url is
        the full request URL (<code>req.originalUrl</code>, node 1.5.0+); older versions recorded{" "}
        <code>/</code> inside Nest middleware:
      </p>
      <CodeBlock
        code={`// telemetry.middleware.ts
import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { middleware } from "@telemetry-tracker/node";

const trackRequest = middleware({ trackRequestBody: false });

@Injectable()
export class TelemetryMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    trackRequest(req, res, next);
  }
}`}
      />

      <CodeBlock
        code={`// app.module.ts
import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { TelemetryMiddleware } from "./telemetry.middleware";

@Module({ /* imports, controllers, providers */ })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TelemetryMiddleware).forRoutes("*");
  }
}`}
      />

      <h2>Handled errors</h2>
      <p>
        Global process handlers and <code>TelemetryInterceptor</code> cover uncaught failures. For
        errors you catch yourself, call <code>trackError</code> to add context:
      </p>
      <CodeBlock
        code={`import { trackError } from "@telemetry-tracker/node";

try {
  await this.ordersService.charge(id);
} catch (err) {
  trackError(err, { orderId: id, handler: "OrdersController.charge" });
  throw err;
}`}
      />

      <h2>Per-request user context</h2>
      <p>
        After authentication, call <code>identify(userId)</code> in a guard or interceptor so
        errors and events include the current user:
      </p>
      <CodeBlock
        code={`import { identify } from "@telemetry-tracker/node";

// e.g. in an AuthGuard or interceptor after validating JWT
identify(req.user.id);`}
      />
    </DocsArticle>
  );
}
