<?php

/*
|--------------------------------------------------------------------------
| Reservation lease (#153)
|--------------------------------------------------------------------------
|
| `retry_after` is how long a driver waits before deciding a reserved job died
| and handing it to another worker. Laravel's rule is absolute: it MUST exceed
| the longest a job can legitimately run, or a still-working job is re-reserved
| and executed a second time while the first is mid-flight.
|
| An AI run is the longest job in this app — up to `AI_JOB_TIMEOUT` (300s by
| default), and now genuinely capable of using it, since #153 lets one model
| call run for the whole budget instead of dying on a 60s socket. At the stock
| 90s lease that means a slow generation would be re-reserved TWICE while still
| running, and each redelivery re-bills the prompt: `ShouldBeUnique` dedupes
| DISPATCHES, not redeliveries, and the run ledger deliberately lets a running
| row be re-claimed (a redelivery after a hard-killed worker has to be able to
| pick the run back up).
|
| So the lease is derived from the same knob the job budget reads, plus room
| for the job's own overhead, and an operator's explicit value can only raise
| it: a lease shorter than the ceiling is not a preference, it is a
| double-billing bug.
*/
$aiLeaseFloor = (int) env('AI_JOB_TIMEOUT', 300) + 60;

return [

    /*
    |--------------------------------------------------------------------------
    | Default Queue Connection Name
    |--------------------------------------------------------------------------
    |
    | Laravel's queue supports a variety of backends via a single, unified
    | API, giving you convenient access to each backend using identical
    | syntax for each. The default queue connection is defined below.
    |
    */

    'default' => env('QUEUE_CONNECTION', 'database'),

    /*
    |--------------------------------------------------------------------------
    | Queue Connections
    |--------------------------------------------------------------------------
    |
    | Here you may configure the connection options for every queue backend
    | used by your application. An example configuration is provided for
    | each backend supported by Laravel. You're also free to add more.
    |
    | Drivers: "sync", "database", "beanstalkd", "sqs", "redis",
    |          "deferred", "background", "failover", "null"
    |
    */

    'connections' => [

        'sync' => [
            'driver' => 'sync',
        ],

        'database' => [
            'driver' => 'database',
            'connection' => env('DB_QUEUE_CONNECTION'),
            'table' => env('DB_QUEUE_TABLE', 'jobs'),
            'queue' => env('DB_QUEUE', 'default'),
            'retry_after' => max($aiLeaseFloor, (int) env('DB_QUEUE_RETRY_AFTER', 90)),
            'after_commit' => false,
        ],

        'beanstalkd' => [
            'driver' => 'beanstalkd',
            'host' => env('BEANSTALKD_QUEUE_HOST', 'localhost'),
            'queue' => env('BEANSTALKD_QUEUE', 'default'),
            'retry_after' => max($aiLeaseFloor, (int) env('BEANSTALKD_QUEUE_RETRY_AFTER', 90)),
            'block_for' => 0,
            'after_commit' => false,
        ],

        'sqs' => [
            'driver' => 'sqs',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'prefix' => env('SQS_PREFIX', 'https://sqs.us-east-1.amazonaws.com/your-account-id'),
            'queue' => env('SQS_QUEUE', 'default'),
            'suffix' => env('SQS_SUFFIX'),
            'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
            'after_commit' => false,
        ],

        'redis' => [
            'driver' => 'redis',
            'connection' => env('REDIS_QUEUE_CONNECTION', 'default'),
            'queue' => env('REDIS_QUEUE', 'default'),
            'retry_after' => max($aiLeaseFloor, (int) env('REDIS_QUEUE_RETRY_AFTER', 90)),
            'block_for' => null,
            'after_commit' => false,
        ],

        'deferred' => [
            'driver' => 'deferred',
        ],

        'background' => [
            'driver' => 'background',
        ],

        'failover' => [
            'driver' => 'failover',
            'connections' => [
                'database',
                'deferred',
            ],
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Job Batching
    |--------------------------------------------------------------------------
    |
    | The following options configure the database and table that store job
    | batching information. These options can be updated to any database
    | connection and table which has been defined by your application.
    |
    */

    'batching' => [
        'database' => env('DB_CONNECTION', 'sqlite'),
        'table' => 'job_batches',
    ],

    /*
    |--------------------------------------------------------------------------
    | Failed Queue Jobs
    |--------------------------------------------------------------------------
    |
    | These options configure the behavior of failed queue job logging so you
    | can control how and where failed jobs are stored. Laravel ships with
    | support for storing failed jobs in a simple file or in a database.
    |
    | Supported drivers: "database-uuids", "dynamodb", "file", "null"
    |
    */

    'failed' => [
        'driver' => env('QUEUE_FAILED_DRIVER', 'database-uuids'),
        'database' => env('DB_CONNECTION', 'sqlite'),
        'table' => 'failed_jobs',
    ],

];
