import { Express, Request, RequestHandler } from "express";
import { getWebsocketMiddlewares } from "../app";

declare module "express-serve-static-core" {
  // eslint-disable-next-line no-unused-vars
  interface Request {
    /**
     * True if either the request 'Origin' header matches our ROOT_URL, or if
     * there was no 'Origin' header (in which case we must give the benefit of
     * the doubt; for example for normal resource GETs).
     */
    isSameOrigin?: boolean;
  }
}

export default (app: Express) => {
  const middleware: RequestHandler = (req: Request, res, next) => {
    const baseUrl =
      process.env.ROOT_URL?.replace(/^https?:\/\//, "") || "don't allow";
    console.log(baseUrl);
    req.isSameOrigin =
      !req.headers.origin || req.headers.origin.indexOf(baseUrl) > -1;
    next();
  };
  app.use(middleware);
  getWebsocketMiddlewares(app).push(middleware);
};
