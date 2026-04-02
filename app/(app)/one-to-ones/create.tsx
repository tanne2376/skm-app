import { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, Alert,
  TouchableOpacity, Platform, FlatList,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SlideUpModal } from '@/components/ui/SlideUpModal';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Location } from '@/types';

export default function CreateOneToOneScreen() {
  const insets = useSafeAreaInsets();
  const { session, profile } = useAuth();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date());
  const [startTime, setStartTime] = useState(new Date());

  const [showDateSheet, setShowDateSheet] = useState(false);
  const [showTimeSheet, setShowTimeSheet] = useState(false);

  // Android only — controls native dialog visibility
  const [showDateDialog, setShowDateDialog] = useState(false);
  const [showTimeDialog, setShowTimeDialog] = useState(false);

  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [customLocation, setCustomLocation] = useState('');
  const [showLocationSheet, setShowLocationSheet] = useState(false);

  const defaultPrice = profile?.oto_default_price ?? 5000;
  const [pricePounds, setPricePounds] = useState((defaultPrice / 100).toFixed(2));

  const { data: locations } = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('*').eq('is_active', true).order('name');
      return (data ?? []) as Location[];
    },
  });

  const locationLabel = selectedLocation?.name ?? 'Select location...';

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error('Title is required.');
      const priceNum = parseFloat(pricePounds);
      if (isNaN(priceNum) || priceNum < 0) throw new Error('Enter a valid price.');
      if (!selectedLocation && !customLocation.trim()) throw new Error('Enter a location.');

      const sessionDateStr = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-');
      const startHH = String(startTime.getHours()).padStart(2, '0');
      const startMM = String(startTime.getMinutes()).padStart(2, '0');
      const startTimeStr = `${startHH}:${startMM}`;

      const { error } = await supabase.from('one_to_ones').insert({
        creator_id: session!.user.id,
        teacher_id: session!.user.id,
        title: title.trim(),
        price: Math.round(priceNum * 100),
        session_date: sessionDateStr,
        start_time: startTimeStr,
        end_time: startTimeStr,
        location_type: selectedLocation ? 'predefined' : 'custom',
        location_id: selectedLocation?.id ?? null,
        location_text: selectedLocation
          ? (customLocation.trim() || selectedLocation.address)
          : customLocation.trim(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['one_to_ones'] });
      Alert.alert('Created!', '1-to-1 session is now available for booking.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="Create 1-to-1" showBack />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* Title */}
        <Card>
          <Text style={styles.fieldLabel}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Pad Work Session"
            placeholderTextColor={COLORS.grey[600]}
          />
        </Card>

        {/* Date */}
        <Card>
          <Text style={styles.fieldLabel}>Date</Text>
          <TouchableOpacity
            style={styles.pickerBtn}
            onPress={() => Platform.OS === 'ios' ? setShowDateSheet(true) : setShowDateDialog(true)}
          >
            <Text style={styles.pickerBtnText}>
              {date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
          </TouchableOpacity>
          {Platform.OS === 'android' && showDateDialog && (
            <DateTimePicker
              value={date}
              mode="date"
              display="default"
              minimumDate={new Date()}
              onChange={(_: DateTimePickerEvent, d?: Date) => {
                setShowDateDialog(false);
                if (d) setDate(d);
              }}
            />
          )}
        </Card>

        {/* Start Time */}
        <Card>
          <Text style={styles.fieldLabel}>Start Time</Text>
          <TouchableOpacity
            style={styles.pickerBtn}
            onPress={() => Platform.OS === 'ios' ? setShowTimeSheet(true) : setShowTimeDialog(true)}
          >
            <Text style={styles.pickerBtnText}>
              {String(startTime.getHours()).padStart(2, '0')}:{String(startTime.getMinutes()).padStart(2, '0')}
            </Text>
          </TouchableOpacity>
          {Platform.OS === 'android' && showTimeDialog && (
            <DateTimePicker
              value={startTime}
              mode="time"
              display="default"
              is24Hour
              onChange={(_: DateTimePickerEvent, t?: Date) => {
                setShowTimeDialog(false);
                if (t) setStartTime(t);
              }}
            />
          )}
        </Card>

        {/* Location */}
        <Card>
          <Text style={styles.fieldLabel}>Location</Text>
          <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowLocationSheet(true)}>
            <Text style={styles.pickerBtnText}>
              {locationLabel}
            </Text>
          </TouchableOpacity>
          <TextInput
            style={[styles.input, { marginTop: 10 }]}
            value={customLocation}
            onChangeText={setCustomLocation}
            placeholder="or type in custom location"
            placeholderTextColor={COLORS.grey[600]}
          />
        </Card>

        {/* Price */}
        <Card>
          <Text style={styles.fieldLabel}>Price (£)</Text>
          <TextInput
            style={styles.input}
            value={pricePounds}
            onChangeText={setPricePounds}
            keyboardType="decimal-pad"
            placeholder="50.00"
            placeholderTextColor={COLORS.grey[600]}
          />
          <Text style={styles.hint}>Default set in Settings → Session Defaults</Text>
        </Card>

        <Button
          variant="primary"
          size="lg"
          onPress={() => createMutation.mutate()}
          loading={createMutation.isPending}
        >
          Create Session
        </Button>
      </ScrollView>

      {/* iOS date picker sheet */}
      <SlideUpModal visible={showDateSheet} onDismiss={() => setShowDateSheet(false)} maxHeight="45%">
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Select Date</Text>
          <DateTimePicker
            value={date}
            mode="date"
            display="spinner"
            minimumDate={new Date()}
            onChange={(_: DateTimePickerEvent, d?: Date) => d && setDate(d)}
            themeVariant="dark"
            style={styles.spinner}
          />
          <Button variant="primary" size="md" onPress={() => setShowDateSheet(false)}>
            Done
          </Button>
        </View>
      </SlideUpModal>

      {/* iOS time picker sheet */}
      <SlideUpModal visible={showTimeSheet} onDismiss={() => setShowTimeSheet(false)} maxHeight="45%">
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Select Time</Text>
          <DateTimePicker
            value={startTime}
            mode="time"
            display="spinner"
            is24Hour
            onChange={(_: DateTimePickerEvent, t?: Date) => t && setStartTime(t)}
            themeVariant="dark"
            style={styles.spinner}
          />
          <Button variant="primary" size="md" onPress={() => setShowTimeSheet(false)}>
            Done
          </Button>
        </View>
      </SlideUpModal>

      {/* Location picker */}
      <SlideUpModal visible={showLocationSheet} onDismiss={() => setShowLocationSheet(false)} maxHeight="60%">
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Select Location</Text>
          <FlatList
            data={[{ id: '__custom__', name: 'Custom location…', address: '' }, ...(locations ?? [])]}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const isSelected = selectedLocation?.id === item.id;
              return (
                <TouchableOpacity
                  style={[styles.sheetItem, isSelected && styles.sheetItemSelected]}
                  onPress={() => {
                    setSelectedLocation(item.id === '__custom__' ? null : (item as Location));
                    setShowLocationSheet(false);
                  }}
                >
                  <Text style={[styles.sheetItemLabel, isSelected && styles.sheetItemLabelSelected]}>{item.name}</Text>
                  {item.address ? <Text style={styles.sheetItemSub}>{item.address}</Text> : null}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </SlideUpModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  content: { padding: 16, gap: 16 },
  fieldLabel: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  input: { backgroundColor: COLORS.grey[800], borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.white, fontSize: 15, borderWidth: 1, borderColor: COLORS.grey[700] },
  hint: { color: COLORS.grey[600], fontSize: 12, marginTop: 6 },
  spinner: { height: 150 },
  pickerBtn: { backgroundColor: COLORS.grey[800], borderRadius: 8, paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: COLORS.grey[700] },
  pickerBtnText: { color: COLORS.white, fontSize: 15 },
  pickerPlaceholder: { color: COLORS.grey[500] },
  sheet: { backgroundColor: COLORS.grey[900], borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: COLORS.grey[800], padding: 20, paddingBottom: 40 },
  sheetHandle: { width: 36, height: 4, backgroundColor: COLORS.grey[700], borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700', marginBottom: 12 },
  sheetItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.grey[800] },
  sheetItemSelected: { backgroundColor: 'rgba(239,68,68,0.1)', marginHorizontal: -20, paddingHorizontal: 20 },
  sheetItemLabel: { color: COLORS.white, fontSize: 15 },
  sheetItemLabelSelected: { color: COLORS.accent, fontWeight: '700' },
  sheetItemSub: { color: COLORS.grey[400], fontSize: 13, marginTop: 2 },
});
