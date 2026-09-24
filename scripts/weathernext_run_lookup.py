"""Small bounded initialization lookup, without projecting global geometry columns."""
def latest_run(client, table, main, cap):
    from google.cloud import bigquery
    import re
    if not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_]+\.weathernext_3_0_0_0p(?:1|05)deg', table):
        raise ValueError('Invalid linked WeatherNext table')
    sql = f'''SELECT MAX(init_time) AS init_time FROM `{table}`
      WHERE init_time BETWEEN TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 DAY) AND CURRENT_TIMESTAMP()'''
    if main:
        sql += ' AND MOD(EXTRACT(HOUR FROM init_time), 6) = 0'
    # The measured two-day partition-key scan requires 2.18 GB. Geometry columns
    # are deliberately NOT selected: their pessimistic scan estimate was 66 GB.
    config = bigquery.QueryJobConfig(maximum_bytes_billed=3_000_000_000)
    job = client.query(sql, job_config=config, location='US')
    rows = list(job.result(timeout=120))
    print('Initialization lookup bytes billed:', job.total_bytes_billed)
    if not rows or rows[0].init_time is None:
        raise RuntimeError('No published initialization in the past two days')
    return rows[0].init_time

if __name__ == '__main__':
    import weather_weathernext_site_collect as collector
    collector.latest_run = latest_run
    collector.main()
