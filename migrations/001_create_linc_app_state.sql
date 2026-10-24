CREATE TABLE IF NOT EXISTS linc_app_state (
    id smallint PRIMARY KEY CHECK (id = 1),
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO linc_app_state (id, data)
VALUES (1, '{"schools":{},"users":{},"revenue":{"total":0}}'::jsonb)
ON CONFLICT (id) DO NOTHING;
