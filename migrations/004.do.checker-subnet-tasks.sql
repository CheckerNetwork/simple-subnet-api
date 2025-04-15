CREATE TABLE IF NOT EXISTS checker_subnet_tasks (
    id BIGSERIAL PRIMARY KEY,
    subnet TEXT NOT NULL,
    round_id BIGINT NOT NULL,
    task_definition JSONB NOT NULL,
    FOREIGN KEY (round_id) REFERENCES checker_rounds (id) ON DELETE CASCADE
);
