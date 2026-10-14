-- Drops the unused users table only when it is empty. If it has rows it is left in place.
DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    DROP TYPE IF EXISTS "role";
  ELSIF (SELECT count(*) FROM "users") = 0 THEN
    DROP TABLE "users";
    DROP TYPE IF EXISTS "role";
  ELSE
    RAISE NOTICE 'users has rows; left in place. Back it up and drop it manually if auth is truly unused.';
  END IF;
END $$;
