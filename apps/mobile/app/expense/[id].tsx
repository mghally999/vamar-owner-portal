import { Image } from 'expo-image';
import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { EXPENSE_KIND_LABEL, WORK_ORDER_STATUS_LABEL } from '@vamar/shared';
import { API_BASE, authHeaders } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { useExpense } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { AskVamar } from '@/ui/ask-vamar';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  Money,
  Row,
  SectionTitle,
  Separator,
  Skeleton,
  Text,
  layout,
} from '@/ui';

/**
 * One expense: the owner's share large, the invoice (image zoomable, PDF opened outside),
 * the reason, category, property, supplier, dates, VAT, the linked maintenance job and case.
 */
export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const { t: tr, pick, date, lang, money } = useI18n();
  const q = useExpense(id);
  const e = q.data;
  const [zoom, setZoom] = useState<string | null>(null);
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;

  const fileUrl = (attachmentId: string) => `${API_BASE}/api/owner/attachments/${attachmentId}`;
  const rows: [string, React.ReactNode][] = e
    ? [
        [tr('expense_reason'), pick(e.reasonAr, e.reasonEn)],
        [
          tr('expense_category'),
          `${pick(e.categoryNameAr, e.categoryNameEn)} · ${EXPENSE_KIND_LABEL[e.kind][lang]}`,
        ],
        [
          tr('expense_property'),
          `${pick(e.buildingNameAr, e.buildingNameEn)}${e.unitNo ? ` ${e.unitNo}` : ` · ${tr('expense_building')}`}`,
        ],
        [tr('expense_vendor'), e.vendorName ?? '—'],
        [tr('expense_invoiceNo'), e.invoiceNo ?? '—'],
        [tr('expense_invoiceDate'), date(e.invoiceDate)],
        ...(e.coversFrom && e.coversTo
          ? ([[tr('expense_covers'), `${date(e.coversFrom)} – ${date(e.coversTo)}`]] as [
              string,
              React.ReactNode,
            ][])
          : []),
        [tr('expense_beforeVat'), money(e.grossAmountFils)],
        [tr('expense_vat'), e.grossVatFils > 0 ? money(e.grossVatFils) : '—'],
        [
          tr('expense_paidOn'),
          e.paidOn
            ? `${date(e.paidOn)}${e.paymentMethod ? ` · ${tr(`expense_payment_${e.paymentMethod}` as MessageKey)}` : ''}`
            : '—',
        ],
        ...(e.disputeCaseNo
          ? ([[tr('expense_dispute'), e.disputeCaseNo]] as [string, React.ReactNode][])
          : []),
      ]
    : [];

  return (
    <ScrollView contentContainerStyle={layout.screen}>
      <View style={{ gap: 6, paddingVertical: 8 }}>
        <Text variant="caption" weight="medium" color="soft">
          {e?.shared
            ? tr('expense_yourShare', {
                share: money(e.amountFils),
                total: money(e.grossTotalFils),
              })
            : tr('expense_detail')}
        </Text>
        {e ? (
          <Money fils={e.amountFils} variant="hero" weight="semibold" color="primary" />
        ) : (
          <Skeleton width={220} height={40} />
        )}
        {e ? <Chip label={EXPENSE_KIND_LABEL[e.kind][lang]} /> : null}
        {e ? (
          <Text variant="secondary">{pick(e.reasonAr, e.reasonEn)}</Text>
        ) : (
          <Skeleton width={240} height={18} />
        )}
      </View>

      <View>
        <SectionTitle>{tr('expense_invoice')}</SectionTitle>
        {!e ? (
          <Skeleton height={160} radius={12} />
        ) : e.attachments.length === 0 ? (
          <Card style={{ padding: 16 }}>
            <Text variant="secondary" color="soft">
              {tr('expense_noFile')}
            </Text>
          </Card>
        ) : (
          <View style={{ gap: 8 }}>
            {e.attachments.map((a) =>
              a.mime === 'application/pdf' ? (
                <Button
                  key={a.id}
                  title={`${tr('expense_openFile')} · ${a.fileName || 'PDF'}`}
                  variant="secondary"
                  onPress={() => void Linking.openURL(fileUrl(a.id))}
                />
              ) : (
                <Pressable
                  key={a.id}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={a.fileName || tr('expense_invoice')}
                  onPress={() => {
                    setZoom(fileUrl(a.id));
                  }}
                >
                  <Image
                    source={{ uri: fileUrl(a.id), headers: authHeaders() }}
                    cachePolicy="memory-disk"
                    style={{ width: '100%', aspectRatio: 1.4, borderRadius: t.radius.md }}
                    contentFit="cover"
                    placeholder={null}
                    transition={150}
                  />
                </Pressable>
              ),
            )}
          </View>
        )}
      </View>

      {!e ? (
        <Skeleton height={240} radius={12} />
      ) : (
        <Card style={{ paddingHorizontal: 16 }}>
          {rows.map(([label, value], i) => (
            <View key={label}>
              {i > 0 ? <Separator /> : null}
              <Row
                style={{
                  justifyContent: 'space-between',
                  minHeight: 48,
                  gap: 12,
                  paddingVertical: 8,
                }}
              >
                <Text variant="secondary" color="soft">
                  {label}
                </Text>
                <Text
                  variant="secondary"
                  weight="medium"
                  tnum
                  style={{ flexShrink: 1, textAlign: 'right' }}
                >
                  {value}
                </Text>
              </Row>
            </View>
          ))}
        </Card>
      )}

      {e?.workOrder ? (
        <View>
          <SectionTitle>{tr('expense_workOrder')}</SectionTitle>
          <Link href={{ pathname: '/work-order/[id]', params: { id: e.workOrder.id } }} asChild>
            <Pressable accessibilityRole="button">
              <Card style={{ padding: 16, gap: 6 }}>
                <Text weight="medium">{pick(e.workOrder.titleAr, e.workOrder.titleEn)}</Text>
                <Text variant="caption" color="soft">
                  {WORK_ORDER_STATUS_LABEL[e.workOrder.status][lang]}
                  {e.workOrder.completedAt
                    ? ` · ${date(e.workOrder.completedAt.slice(0, 10))}`
                    : ''}
                </Text>
              </Card>
            </Pressable>
          </Link>
        </View>
      ) : null}

      <Modal
        visible={zoom !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setZoom(null);
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('back')}
          onPress={() => {
            setZoom(null);
          }}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center' }}
        >
          {zoom ? (
            <ScrollView
              maximumZoomScale={4}
              minimumZoomScale={1}
              bouncesZoom
              centerContent
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
            >
              <Image
                source={{ uri: zoom, headers: authHeaders() }}
                cachePolicy="memory-disk"
                style={{ width: '100%', aspectRatio: Platform.OS === 'web' ? 0.75 : 0.72 }}
                contentFit="contain"
                accessibilityLabel={tr('expense_invoice')}
              />
            </ScrollView>
          ) : null}
        </Pressable>
      </Modal>
      <AskVamar type="expense" id={id} label={e ? pick(e.reasonAr, e.reasonEn) : null} />
    </ScrollView>
  );
}
