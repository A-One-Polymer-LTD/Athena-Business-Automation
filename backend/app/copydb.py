"""Copy every table from one database to another in bulk (much faster than seeding over a slow link).

    python -m app.copydb <source_url> <target_url>

The target tables are dropped and recreated. Used to load the sample data into a hosted PostgreSQL database.
"""
import ssl
import sys

from sqlalchemy import create_engine, text

from . import models  # noqa: F401  (registers the tables)
from .database import Base


def _engine(url: str):
    if url.startswith(("postgres://", "postgresql://")):
        url = "postgresql+pg8000://" + url.split("://", 1)[1].split("?", 1)[0]
        return create_engine(url, connect_args={"ssl_context": ssl.create_default_context()})
    return create_engine(url)


def main(source_url: str, target_url: str):
    src, dst = _engine(source_url), _engine(target_url)
    Base.metadata.drop_all(dst)
    Base.metadata.create_all(dst)
    with src.connect() as s, dst.begin() as d:
        for table in Base.metadata.sorted_tables:
            rows = [dict(r._mapping) for r in s.execute(table.select())]
            step = 20 if table.name == "stored_files" else 250
            for i in range(0, len(rows), step):
                d.execute(table.insert().values(rows[i:i + step]))  # one statement per batch
            print(f"{table.name}: {len(rows)}")
        if dst.dialect.name == "postgresql":
            # continue the id sequences after the copied rows
            for table in Base.metadata.sorted_tables:
                if "id" in table.c and table.c.id.type.python_type is int:
                    d.execute(text(f"SELECT setval(pg_get_serial_sequence('{table.name}', 'id'), "
                                   f"COALESCE((SELECT MAX(id) FROM {table.name}), 1))"))
    print("Copy complete.")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
