FROM php:8.5-cli-alpine

RUN apk add --no-cache \
    git \
    icu-dev \
    libzip-dev \
    oniguruma-dev \
    postgresql-dev \
    unzip \
    && docker-php-ext-install \
        bcmath \
        intl \
        mbstring \
        pcntl \
        pdo_pgsql \
        zip

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

COPY composer.json composer.lock ./
RUN composer install --no-dev --prefer-dist --no-interaction --no-scripts

COPY . .

RUN composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader \
    && php artisan package:discover --ansi

EXPOSE 80

ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["app"]
