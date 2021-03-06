import { urlencoded } from "body-parser";
import { Express, Request, RequestHandler, Response } from "express";
import { Pool } from "pg";
import { getRootPgPool } from "./installDatabasePools";

export default (app: Express) => {
  // Only enable this in test/development mode
  if (!["test", "development"].includes(process.env.NODE_ENV || "")) {
    throw new Error("This code must not run in production");
  }

  /*
   * Furthermore we require the `ENABLE_CYPRESS_COMMANDS` environmental variable
   * to be set; this gives us extra protection against accidental XSS/CSRF
   * attacks.
   */
  const safeToRun = process.env.ENABLE_CYPRESS_COMMANDS === "1";

  const rootPgPool = getRootPgPool(app);

  /*
   * This function is invoked for the /cypressServerCommand route and is
   * responsible for parsing the request and handing it off to the relevant
   * function.
   */
  const handleCypressServerCommand: RequestHandler = async (req, res, next) => {
    /*
     * If we didn't set ENABLE_CYPRESS_COMMANDS, output a warning to the server
     * log, and then pretend the /cypressServerCommand route doesn't exist.
     */
    if (!safeToRun) {
      console.error(
        "/cypressServerCommand denied because ENABLE_CYPRESS_COMMANDS is not set."
      );
      // Pretend like nothing happened
      return next();
    }

    try {
      // Try to read and parse the commands from the request.
      const { query } = req;
      if (!query) {
        throw new Error("Query not specified");
      }

      const { command: rawCommand, payload: rawPayload } = query;
      if (!rawCommand) {
        throw new Error("Command not specified");
      }

      const command = String(rawCommand);
      const payload = rawPayload ? JSON.parse(String(rawPayload)) : {};

      // Now run the actual command:
      const result = await runCommand(req, res, rootPgPool, command, payload);

      if (result === null) {
        /*
         * When a command returns null, we assume they've handled sending the
         * response. This allows commands to do things like redirect to new
         * pages when they're done.
         */
      } else {
        /*
         * The command returned a result, send it back to the test suite.
         */
        res.json(result);
      }
    } catch (e) {
      /*
       * If anything goes wrong, let the test runner know so that it can fail
       * the test.
       */
      console.error("cypressServerCommand failed!");
      console.error(e);
      res.status(500).json({
        error: {
          message: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
        },
      });
    }
  };
  app.get(
    "/cypressServerCommand",
    urlencoded({ extended: false }),
    handleCypressServerCommand
  );
};

async function runCommand(
  req: Request,
  res: Response,
  rootPgPool: Pool,
  command: string,
  payload: { [key: string]: any }
): Promise<object | null> {
  if (command === "clearTestUsers") {
    await rootPgPool.query(
      "delete from app_public.users where username like 'testuser%'"
    );
    return { success: true };
  } else if (command === "clearTestOrganizations") {
    await rootPgPool.query(
      "delete from app_public.organizations where slug like 'test%'"
    );
    return { success: true };
  } else if (command === "createUser") {
    if (!payload) {
      throw new Error("Payload required");
    }
    const {
      username = "testuser",
      email = `${username}@example.com`,
      verified = false,
      name = username,
      avatarUrl = null,
      password = "TestUserPassword",
    } = payload;
    if (!username.startsWith("testuser")) {
      throw new Error("Test user usernames may only start with 'testuser'");
    }
    const user = await reallyCreateUser(rootPgPool, {
      username,
      email,
      verified,
      name,
      avatarUrl,
      password,
    });

    let verificationToken: string | null = null;
    const userEmailSecrets = await getUserEmailSecrets(rootPgPool, email);
    const userEmailId: string = userEmailSecrets.user_email_id;
    if (!verified) {
      verificationToken = userEmailSecrets.verification_token;
    }

    return { user, userEmailId, verificationToken };
  } else if (command === "login") {
    const {
      username = "testuser",
      email = `${username}@example.com`,
      verified = false,
      name = username,
      avatarUrl = null,
      password = "TestUserPassword",
      _next = "/",
      _orgs = [],
    } = payload;
    const _user = await reallyCreateUser(rootPgPool, {
      username,
      email,
      verified,
      name,
      avatarUrl,
      password,
    });
    const _otherUser = await reallyCreateUser(rootPgPool, {
      username: "testuser_other",
      email: "testuser_other@example.com",
      name: "testuser_other",
      verified: true,
      password: "DOESNT MATTER",
    });

    const client = await rootPgPool.connect();
    try {
      await client.query("begin");
      try {
        console.log("Creating user", _user.id);
      } finally {
        await client.query("commit");
      }
    } finally {
      await client.release();
    }
    return null;
  } else if (command === "getEmailSecrets") {
    const { email = "testuser@example.com" } = payload;
    const userEmailSecrets = await getUserEmailSecrets(rootPgPool, email);
    return userEmailSecrets;
  } else {
    throw new Error(`Command '${command}' not understood.`);
  }
}

async function reallyCreateUser(
  rootPgPool: Pool,
  {
    username,
    email,
    verified,
    name,
    avatarUrl,
    password,
  }: {
    username?: string;
    email?: string;
    verified?: boolean;
    name?: string;
    avatarUrl?: string;
    password?: string;
  }
) {
  const {
    rows: [user],
  } = await rootPgPool.query(
    `SELECT * FROM app_private.really_create_user(
        username := $1,
        email := $2,
        email_is_verified := $3,
        name := $4,
        avatar_url := $5,
        password := $6
      )`,
    [username, email, verified, name, avatarUrl, password]
  );
  return user;
}

async function getUserEmailSecrets(rootPgPool: Pool, email: string) {
  const {
    rows: [userEmailSecrets],
  } = await rootPgPool.query(
    `
      select *
      from app_private.user_email_secrets
      where user_email_id = (
        select id
        from app_public.user_emails
        where email = $1
        order by id desc
        limit 1
      )
    `,
    [email]
  );
  return userEmailSecrets;
}
