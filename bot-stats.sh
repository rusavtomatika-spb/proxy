#!/bin/bash
LOG_FILE="/var/log/nginx/bot-all.log"
HISTORY_FILE="/var/www/html/bot-history.txt"
TEMP_FILE="/tmp/bot-history-temp.txt"

# Если файла нет - показываем предупреждение
if [ ! -f "$LOG_FILE" ]; then
    echo "❌ Файл лога не найден: $LOG_FILE"
    echo "Логи будут собираться с момента создания файла."
    exit 1
fi

# Собираем статистику
TODAY=$(date +%d.%m.%Y)
TODAY_UNIQUE=$(cat $LOG_FILE 2>/dev/null | grep "$(date +%d/%b/%Y)" | awk '{print $1}' | sort -u | wc -l)
TODAY_VISITS=$(cat $LOG_FILE 2>/dev/null | grep "$(date +%d/%b/%Y)" | wc -l)
TOTAL_UNIQUE=$(cat $LOG_FILE 2>/dev/null | awk '{print $1}' | sort -u | wc -l)
TOTAL_VISITS=$(cat $LOG_FILE 2>/dev/null | wc -l)

# Новая запись для сегодня
NEW_ENTRY="[$TODAY] Уникальных: $TODAY_UNIQUE, Визитов: $TODAY_VISITS, Всего уникальных: $TOTAL_UNIQUE, Всего визитов: $TOTAL_VISITS"

# Обновляем историю (удаляем старую запись за сегодня, если есть)
if [ -f "$HISTORY_FILE" ]; then
    # Удаляем строку с сегодняшней датой, если она есть
    grep -v "\[$TODAY\]" "$HISTORY_FILE" > "$TEMP_FILE"
    # Добавляем новую запись
    echo "$NEW_ENTRY" >> "$TEMP_FILE"
    # Сортируем по дате (по убыванию - свежие сверху)
    sort -r "$TEMP_FILE" -o "$HISTORY_FILE"
    rm "$TEMP_FILE"
else
    # Если файла нет - просто создаём с новой записью
    echo "$NEW_ENTRY" > "$HISTORY_FILE"
fi

# Вывод на экран
echo "=== 📊 СТАТИСТИКА БОТА ==="
echo "📁 Лог-файл: $LOG_FILE"
echo "📅 Дата: $(date)"
echo "─────────────────────────"

echo "📈 ЗА ВСЁ ВРЕМЯ:"
echo "   👥 Уникальных пользователей: $TOTAL_UNIQUE"
echo "   🔄 Всего визитов: $TOTAL_VISITS"
echo ""

echo "📆 ЗА СЕГОДНЯ ($TODAY):"
echo "   👥 Уникальных пользователей: $TODAY_UNIQUE"
echo "   🔄 Визитов: $TODAY_VISITS"
echo ""

echo "📊 ИСТОРИЯ:"
if [ -f "$HISTORY_FILE" ]; then
    cat "$HISTORY_FILE"
else
    echo "   ❌ История пока пуста"
fi
echo ""

echo "🏆 ТОП-10 ЗА ВСЁ ВРЕМЯ:"
if [ -s "$LOG_FILE" ]; then
    cat $LOG_FILE | awk '{print $1}' | sort | uniq -c | sort -nr | head -10 | while read count ip; do
        echo "   $count - $ip"
    done
else
    echo "   ❌ Лог-файл пуст"
fi
echo "─────────────────────────"