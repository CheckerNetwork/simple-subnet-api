CREATE TABLE IF NOT EXISTS daily_measurements (
    subnet TEXT,
    day DATE NOT NULL,
    total BIGINT NOT NULL,
    successful BIGINT NOT NULL,
    CHECK(total >= successful),
    PRIMARY KEY (subnet, day)
);

CREATE INDEX IF NOT EXISTS daily_measurements_day ON daily_measurements (day);
