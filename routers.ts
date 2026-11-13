import { publicProcedure, router } from "./_core/trpc";
import { plannerRouter } from "./plannerRouter";
import { clearParentUnlockCookie } from "./plannerSecurity";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so the gateway can route correctly
  planner: plannerRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    // Signing out of Supabase happens in the browser; this also locks parent mode.
    logout: publicProcedure.mutation(({ ctx }) => {
      clearParentUnlockCookie(ctx.res);
      return {
        success: true,
      } as const;
    }),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
