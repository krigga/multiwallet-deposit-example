create table collections (
    id bigserial not null primary key,
    user_id bigint not null,
    seqno int not null,
    cause_deposit_id bigint not null unique,
    lt bigint,
    success boolean,
    jetton_id int,
    jetton_value decimal,
    jetton_from_lt bigint,
    jetton_from_seqno int
);

create unique index on collections (user_id, seqno);

create table deposits (
    id bigserial not null primary key,
    user_id bigint not null,
    value decimal,
    jetton_id int,
    tx_hash text not null,
    tx_lt bigint not null,
    processed boolean not null default false
);

create unique index on deposits (tx_hash, tx_lt);

create table globals (
    id text not null primary key,
    value text not null
);

-- todo: set modern last_processed_mc_block
insert into globals (id, value) values ('next_query_id', '0'), ('last_known_tx_utime', '0'), ('last_processed_mc_block', '0');

create table jettons (
    id serial not null primary key,
    name text not null unique,
    address text not null,
    wallet text not null
);

create table topup_requests (
    id bigserial not null primary key,
    user_id bigint not null,
    cause_deposit_id bigint unique,
    query_id int,
    created_at bigint,
    processed boolean default false,
    was_recreated boolean default false,
    sent boolean
);

create table users (
    id bigserial not null primary key,
    wallet text not null,
    seed text not null,
    seqno int not null default 0
);

create table users_jettons (
    user_id bigint not null,
    jetton_id int not null,
    jetton_wallet text not null,
    primary key (user_id, jetton_id)
);
